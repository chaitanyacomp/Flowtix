@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
where node >nul 2>&1 || (echo [install-validate] ERROR: node not on PATH. & exit /b 1)
call node "%SCRIPT_DIR%install-validate.js" %*
exit /b %ERRORLEVEL%
