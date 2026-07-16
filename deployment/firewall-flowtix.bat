@echo off
REM FT-DEP-001 Milestone 2 — Windows firewall helper (idempotent)
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
set "NODE_SCRIPT=%SCRIPT_DIR%firewall-flowtix.js"

where node >nul 2>&1
if errorlevel 1 (
  echo [firewall-flowtix] ERROR: node is not on PATH.
  exit /b 1
)

call node "%NODE_SCRIPT%" %*
exit /b %ERRORLEVEL%
