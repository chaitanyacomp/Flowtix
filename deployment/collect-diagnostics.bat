@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
where node >nul 2>&1 || (echo [collect-diagnostics] ERROR: node not on PATH. & exit /b 1)
call node "%SCRIPT_DIR%collect-diagnostics.js" %*
exit /b %ERRORLEVEL%
