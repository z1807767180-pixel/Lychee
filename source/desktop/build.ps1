param([Parameter(Mandatory=$true)][string]$SiteZip,[Parameter(Mandatory=$true)][string]$Icon,[Parameter(Mandatory=$true)][string]$OutputExe)
$ErrorActionPreference='Stop'
$csc=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$fx=Split-Path $csc
$sdk=Get-ChildItem -Path "$env:ProgramFiles/Microsoft Visual Studio/*/*/Common7/IDE/PrivateAssemblies" -Directory |
    Where-Object { (Test-Path (Join-Path $_.FullName 'Microsoft.Web.WebView2.Wpf.dll')) -and (Test-Path (Join-Path $_.FullName 'WebView2Loader.dll')) } | Select-Object -First 1
if(!$sdk){throw 'WebView2 SDK assemblies are required only on the build machine.'}
$opts=@('/nologo','/target:winexe','/platform:x64','/optimize+','/codepage:65001',"/out:$OutputExe","/win32icon:$Icon","/resource:$SiteZip,Lychee.Site")
foreach($dll in @('WPF/PresentationFramework.dll','WPF/PresentationCore.dll','WPF/WindowsBase.dll','System.Xaml.dll','System.IO.Compression.dll')) {
 $opts+="/reference:$(Join-Path $fx $dll)"
}
foreach($dll in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.Wpf.dll','WebView2Loader.dll')) {
 $source=Join-Path $sdk.FullName $dll
 $opts+="/resource:$source,$dll"
 if($dll -ne 'WebView2Loader.dll'){ $opts+="/reference:$source" }
}
& $csc @opts (Join-Path $PSScriptRoot 'GardenWindow.cs')
exit $LASTEXITCODE
