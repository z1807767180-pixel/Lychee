param([Parameter(Mandatory=$true)][string]$SiteZip,[Parameter(Mandatory=$true)][string]$Icon,[Parameter(Mandatory=$true)][string]$OutputExe,
      [string]$Version,[string]$QaInstance,[string]$Python='python')
$ErrorActionPreference='Stop'
$csc=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$fx=Split-Path $csc
$sdk=Get-ChildItem -Path "$env:ProgramFiles/Microsoft Visual Studio/*/*/Common7/IDE/PrivateAssemblies" -Directory |
    Where-Object { (Test-Path (Join-Path $_.FullName 'Microsoft.Web.WebView2.Wpf.dll')) -and (Test-Path (Join-Path $_.FullName 'WebView2Loader.dll')) } | Select-Object -First 1
if(!$sdk){throw 'WebView2 SDK assemblies are required only on the build machine.'}
$opts=@('/nologo','/target:winexe','/platform:x64','/optimize+','/codepage:65001',"/out:$OutputExe","/win32icon:$Icon","/resource:$Icon,Lychee.WindowIcon","/resource:$SiteZip,Lychee.Site")
foreach($dll in @('WPF/PresentationFramework.dll','WPF/PresentationCore.dll','WPF/WindowsBase.dll','System.Xaml.dll','System.IO.Compression.dll','System.Net.Http.dll','System.Runtime.Serialization.dll','System.Web.Extensions.dll')) {
 $opts+="/reference:$(Join-Path $fx $dll)"
}
foreach($dll in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.Wpf.dll','WebView2Loader.dll')) {
 $source=Join-Path $sdk.FullName $dll
 $opts+="/resource:$source,$dll"
 if($dll -ne 'WebView2Loader.dll'){ $opts+="/reference:$source" }
}
$identity=Join-Path ([IO.Path]::GetTempPath()) ('LycheeIdentity-'+[guid]::NewGuid().ToString('N')+'.cs')
try {
    $identityArgs=@((Join-Path $PSScriptRoot 'build_identity.py'),$identity)
    if ($Version) {$identityArgs+=@('--version',$Version)}
    if ($QaInstance) {$identityArgs+=@('--qa-instance',$QaInstance)}
    & $Python @identityArgs
    if ($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    & $csc @opts $identity (Join-Path $PSScriptRoot 'GardenWindow.cs') (Join-Path $PSScriptRoot 'WindowsUpdateFeed.cs') (Join-Path $PSScriptRoot 'WindowsUpdateApply.cs')
    exit $LASTEXITCODE
} finally { if(Test-Path -LiteralPath $identity){Remove-Item -LiteralPath $identity} }
