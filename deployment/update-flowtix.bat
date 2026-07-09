@echo off
REM FT-DEP-001 Batch 6 — one-click update orchestrator.
REM Runs: validate → confirm → backup → migrate → replace app/web → verify.
REM Does NOT rollback, install Windows Service, or touch shared/logs/backups.
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "NODE_SCRIPT=%SCRIPT_DIR%update-flowtix.js"

if not exist "%NODE_SCRIPT%" (
  echo [update-flowtix] ERROR: update-flowtix.js not found beside this script.
  echo                   Expected: %NODE_SCRIPT%
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [update-flowtix] ERROR: node is not on PATH.
  exit /b 1
)

echo [update-flowtix] Starting Flowtix update orchestrator...
call node "%NODE_SCRIPT%" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo [update-flowtix] Update failed with exit code %RC%.
  exit /b %RC%
)
echo [update-flowtix] Update finished.
exit /b 0
