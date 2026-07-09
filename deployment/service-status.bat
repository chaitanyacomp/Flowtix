@echo off
REM FT-DEP-001 Batch 8 — status of Flowtix ERP Windows Service.
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call node "%SCRIPT_DIR%service-manage.js" status %*
exit /b %ERRORLEVEL%
