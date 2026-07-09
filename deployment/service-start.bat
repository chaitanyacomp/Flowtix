@echo off
REM FT-DEP-001 Batch 8 — start Flowtix ERP Windows Service (no-op if not installed).
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call node "%SCRIPT_DIR%service-manage.js" start %*
exit /b %ERRORLEVEL%
