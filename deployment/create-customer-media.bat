@echo off
REM FT-DEP-001 Milestone 4 — assemble commercial customer delivery media
setlocal
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%create-customer-media.js" %*
exit /b %ERRORLEVEL%
