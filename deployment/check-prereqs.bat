@echo off
REM FT-DEP-001 Batch 9 — prerequisite checker.
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
call node "%SCRIPT_DIR%check-prereqs.js" %*
exit /b %ERRORLEVEL%
