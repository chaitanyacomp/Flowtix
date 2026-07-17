@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%certify-customer-media.js" %*
exit /b %ERRORLEVEL%
