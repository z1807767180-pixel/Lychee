@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
call :restore Lychee.exe 635375f965bcb027a03703c04b9b16f94aa41570bd7a9b4df65d5603df28581e
if errorlevel 1 goto failed
call :restore Lychee.msi d55b5c95579c624ed761acfb55f712292e377da0345783d43bfc25ac07bcdb7a
if errorlevel 1 goto failed
echo Verified Lychee.exe and Lychee.msi for Windows 6.4.7.
popd
exit /b 0

:restore
if exist "%~1" (
    call :verify "%~1" "%~2"
    exit /b
)
set "tempName=%~1.%RANDOM%-%RANDOM%.partial"
if exist "%tempName%" exit /b 1
copy /b "parts\%~1.001"+"parts\%~1.002"+"parts\%~1.003"+"parts\%~1.004"+"parts\%~1.005" "%tempName%" >nul
if errorlevel 1 exit /b 1
call :verify "%tempName%" "%~2"
if errorlevel 1 exit /b 1
ren "%tempName%" "%~1" || exit /b 1
exit /b 0

:verify
certutil -hashfile "%~1" SHA256 | findstr /i /x /c:"%~2" >nul
exit /b %errorlevel%

:failed
echo Could not verify both files. Check that the five parts for each file are present and that existing output files match the release.
popd
exit /b 1
