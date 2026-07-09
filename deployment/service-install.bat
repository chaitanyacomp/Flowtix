@echo off
REM FT-DEP-001 Batch 8 — install Flowtix ERP as optional Windows Service (WinSW).
REM Requires Administrator. Does not modify shared/.env, backups, or database.
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
set "NODE_SCRIPT=%SCRIPT_DIR%service-manage.js"
if not exist "%NODE_SCRIPT%" (
  echo [service-install] ERROR: service-manage.js not found.
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo [service-install] ERROR: node is not on PATH.
  exit /b 1
)
call node "%NODE_SCRIPT%" install %*
exit /b %ERRORLEVEL%
