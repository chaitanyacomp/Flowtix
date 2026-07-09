@echo off
REM FT-DEP-001 Batch 8 — uninstall Flowtix ERP Windows Service (optional).
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call node "%SCRIPT_DIR%service-manage.js" uninstall %*
exit /b %ERRORLEVEL%
