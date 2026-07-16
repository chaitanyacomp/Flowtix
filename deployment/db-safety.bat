@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
where node >nul 2>&1 || (echo [db-safety] ERROR: node not on PATH. & exit /b 1)
call node "%SCRIPT_DIR%db-safety.js" %*
exit /b %ERRORLEVEL%
