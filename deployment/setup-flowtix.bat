@echo off
REM FT-DEP-001 Batch 9 — client setup / bootstrap (not MSI).
REM Does NOT overwrite shared\.env, wipe DB, or require Windows Service.
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
set "NODE_SCRIPT=%SCRIPT_DIR%setup-flowtix.js"
if not exist "%NODE_SCRIPT%" (
  echo [setup-flowtix] ERROR: setup-flowtix.js not found.
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo [setup-flowtix] ERROR: node is not on PATH.
  exit /b 1
)
echo [setup-flowtix] Starting Flowtix client setup...
call node "%NODE_SCRIPT%" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo [setup-flowtix] Setup failed with exit code %RC%.
  exit /b %RC%
)
echo [setup-flowtix] Setup finished.
exit /b 0
