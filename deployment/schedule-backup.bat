@echo off
REM Flowtix daily backup scheduled task helper (install / verify / remove).
REM Does NOT print database passwords. Development homes skip install by default.
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "NODE_SCRIPT=%SCRIPT_DIR%schedule-backup.js"

if not exist "%NODE_SCRIPT%" (
  echo [schedule-backup] ERROR: schedule-backup.js not found beside this script.
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [schedule-backup] ERROR: node is not on PATH.
  exit /b 1
)

call node "%NODE_SCRIPT%" %*
exit /b %ERRORLEVEL%
