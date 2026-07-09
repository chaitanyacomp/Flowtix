@echo off
REM FT-DEP-001 Batch 9 — idempotent folder initialization.
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call node "%SCRIPT_DIR%init-folders.js" %*
exit /b %ERRORLEVEL%
