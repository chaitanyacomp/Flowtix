@echo off
REM FT-DEP-001 Batch 7 — safe app/web rollback from pre-update archive.
REM Does NOT restore MySQL, run Prisma, touch shared/.env, or delete archives.
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "NODE_SCRIPT=%SCRIPT_DIR%rollback-flowtix.js"

if not exist "%NODE_SCRIPT%" (
  echo [rollback-flowtix] ERROR: rollback-flowtix.js not found beside this script.
  echo                     Expected: %NODE_SCRIPT%
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [rollback-flowtix] ERROR: node is not on PATH.
  exit /b 1
)

echo [rollback-flowtix] Starting Flowtix app/web rollback...
call node "%NODE_SCRIPT%" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo [rollback-flowtix] Rollback failed with exit code %RC%.
  exit /b %RC%
)
echo [rollback-flowtix] Rollback finished.
exit /b 0
