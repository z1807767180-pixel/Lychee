param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string]$Manifest,
    [Parameter(Mandatory = $true)][string]$Evidence,
    [switch]$ExpectBlocked
)

# Use powershell.exe -NoProfile -File so the packaged .NET Framework updater
# runs in an isolated process. No MSI installation or EXE replacement occurs.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Use Windows PowerShell 5.1.' }

Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public sealed class LycheeOriginProxy : IWebProxy, IDisposable {
    const string Allowed = "lychee-link-check.onrender.com";
    readonly IWebProxy original;
    readonly TcpListener listener;
    readonly Uri rejected;
    readonly Thread worker;
    volatile bool stopped;
    public readonly ConcurrentQueue<string> Decisions = new ConcurrentQueue<string>();
    public readonly ConcurrentQueue<string> Refused = new ConcurrentQueue<string>();
    public LycheeOriginProxy(IWebProxy upstream) {
        original = upstream;
        listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        rejected = new Uri("http://127.0.0.1:"+((IPEndPoint)listener.LocalEndpoint).Port);
        worker = new Thread(Serve); worker.IsBackground = true; worker.Start();
    }
    bool Allow(Uri url) {
        bool ok = url.Scheme == "https" && url.IsDefaultPort && url.Host == Allowed && url.UserInfo.Length == 0;
        Decisions.Enqueue((ok ? "ALLOW " : "DENY ") + url.GetLeftPart(UriPartial.Path));
        return ok;
    }
    public bool IsBypassed(Uri url) {
        return Allow(url) && (original == null || original.IsBypassed(url));
    }
    public Uri GetProxy(Uri url) { return Allow(url) ? (original == null ? url : original.GetProxy(url)) : rejected; }
    public ICredentials Credentials { get; set; }
    void Serve() {
        while (!stopped) {
            try {
                using (var peer = listener.AcceptTcpClient()) {
                    peer.ReceiveTimeout = 4000; peer.SendTimeout = 4000;
                    using (var io = peer.GetStream())
                    using (var reader = new StreamReader(io, Encoding.ASCII, false, 1024, true)) {
                        string first = reader.ReadLine() ?? "";
                        // HTTPS CONNECT only. Retain destination host/port, never headers.
                        string[] parts = first.Split(' ');
                        if (parts.Length >= 2 && parts[0] == "CONNECT") Refused.Enqueue(parts[1]);
                        for (int i = 0; i < 64 && !String.IsNullOrEmpty(reader.ReadLine()); i++) { }
                        byte[] bytes = Encoding.ASCII.GetBytes("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        io.Write(bytes, 0, bytes.Length);
                    }
                }
            } catch (SocketException) { if (stopped) return; }
              catch (IOException) { if (stopped) return; }
        }
    }
    public void Dispose() { stopped = true; listener.Stop(); worker.Join(5000); }
}
'@

function Remove-VerifiedDownload([string]$Path, [string]$Name) {
    $expectedRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'LycheeGardenDesktop\Updates'
    $file = Get-Item -LiteralPath $Path -Force
    $dir = $file.Directory
    if ($file.Name -ne $Name -or $dir.Name -notmatch '^[a-f0-9]{32}$' -or
        $dir.Parent.FullName -ne $expectedRoot) { throw "Unexpected download location: $Path" }
    foreach ($entry in @($file,$dir,$dir.Parent,$dir.Parent.Parent)) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Unexpected reparse point: $entry" }
    }
    Remove-Item -LiteralPath $file.FullName -Force
    # Directory.Delete is deliberately non-recursive and refuses non-empty directories.
    [IO.Directory]::Delete($dir.FullName)
}

$binary = (Resolve-Path -LiteralPath $Exe).Path
$expected = Get-Content -Raw -Encoding UTF8 -LiteralPath $Manifest | ConvertFrom-Json
$reportPath = [IO.Path]::GetFullPath($Evidence)
if ([IO.File]::Exists($reportPath)) { throw "Choose a new report path: $reportPath" }
[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($reportPath))
$assembly = [Reflection.Assembly]::LoadFrom($binary)
$feed = $assembly.GetType('WindowsUpdateFeed', $true)
$original = [Net.WebRequest]::DefaultWebProxy
$proxy = New-Object LycheeOriginProxy -ArgumentList @(,$original)
$report = [ordered]@{
    utc = [datetime]::UtcNow.ToString('o')
    clientVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($binary).FileVersion
    clientSha256 = (Get-FileHash -LiteralPath $binary).Hash.ToLowerInvariant()
    expectedFeed = $expected.version
    scenario = $(if ($ExpectBlocked) { 'legacy blocked' } else { 'production origin' })
    packages = @()
    passed = $false
}
try {
    [Net.WebRequest]::DefaultWebProxy = $proxy
    $task = $feed.GetMethod('CheckAsync').Invoke($null, [object[]](,$null))
    try {
        $release = $task.GetAwaiter().GetResult()
    } catch {
        if (!$ExpectBlocked) { throw }
        $blocked = @($proxy.Refused.ToArray())
        if ($blocked -notcontains 'raw.githubusercontent.com:443' -or $blocked -notcontains 'api.github.com:443' -or
            @($proxy.Decisions.ToArray() | Where-Object { $_ -like 'ALLOW *' }).Count) { throw }
        $report.expectedFailure = $_.Exception.GetBaseException().Message
        $report.passed = $true
        return
    }
    if ($ExpectBlocked) { throw 'Legacy control unexpectedly obtained a manifest.' }
    if ($null -eq $release) { throw 'Expected a production manifest.' }
    $releaseVersion = $release.GetType().GetProperty('Version').GetValue($release).ToString()
    if ($releaseVersion -ne $expected.version) { throw "Expected feed $($expected.version), got $releaseVersion" }
    $report.manifestVersion = $releaseVersion
    foreach ($kind in 'exe','msi') {
        $asset = @($expected.assets | Where-Object { $_.kind -eq $kind })
        if ($asset.Count -ne 1) { throw "Missing unique $kind in pinned manifest." }
        $task = $feed.GetMethod('DownloadAsync').Invoke($null, [object[]]@($release,$kind,$null))
        $package = $task.GetAwaiter().GetResult()
        $filePath = $package.GetType().GetProperty('Path').GetValue($package)
        try {
            $verified = $feed.GetMethod('VerifyDownloaded').Invoke($null, [object[]]@(,$package))
            $hash = (Get-FileHash -LiteralPath $filePath).Hash.ToLowerInvariant()
            $length = (Get-Item -LiteralPath $filePath).Length
            if (!$verified -or $hash -ne $asset[0].sha256 -or $length -ne $asset[0].length) {
                throw "Updater or independent verification failed for $kind."
            }
            $report.packages += [ordered]@{ kind=$kind; file=$asset[0].name; bytes=$length; sha256=$hash; updaterVerified=$verified }
        } finally { Remove-VerifiedDownload $filePath ("Lychee."+$kind) }
    }
    $blocked = @($proxy.Refused.ToArray())
    if ($blocked -notcontains 'raw.githubusercontent.com:443') { throw 'No observed refusal of the primary manifest.' }
    $allowed = @($proxy.Decisions.ToArray())
    $base = 'ALLOW https://lychee-link-check.onrender.com/windows-update/'
    if (@($allowed | Where-Object { $_ -like 'ALLOW *' -and !$_.StartsWith($base) }).Count) {
        throw 'An outbound request outside the production update directory was allowed.'
    }
    foreach ($path in 'stable.json',("windows-v$releaseVersion/Lychee.exe"),("windows-v$releaseVersion/Lychee.msi")) {
        if ($allowed -notcontains ($base+$path)) { throw "No observed origin request for $path" }
    }
    $report.passed = $true
} catch {
    $report.error = $_.Exception.ToString()
    throw
} finally {
    [Net.WebRequest]::DefaultWebProxy = $original
    $proxy.Dispose()
    $report.proxyDecisions = @($proxy.Decisions.ToArray() | Select-Object -Unique)
    $report.blockedConnect = @($proxy.Refused.ToArray())
    [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    Write-Output $reportPath
}
