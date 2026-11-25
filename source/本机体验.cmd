@echo off
cd /d "%~dp0"
if defined LYCHEE_PROVIDER_ENV_FILE (
  node --env-file="%LYCHEE_PROVIDER_ENV_FILE%" desktop/preview.mjs
) else (
  node desktop/preview.mjs
)
if errorlevel 1 pause
