@echo off
REM FT-DEP-001 Batch 11 — read-only install verification (no mutate / no secrets).
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call node "%SCRIPT_DIR%verify-install.js" %*
exit /b %ERRORLEVEL%
