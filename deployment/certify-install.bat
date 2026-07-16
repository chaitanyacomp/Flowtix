@echo off
setlocal
REM FT-DEP-001 Milestone 3 Phase H — clean-machine certification (safe lab simulations)
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%certify-install.js" %*
exit /b %ERRORLEVEL%
