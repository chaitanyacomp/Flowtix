@echo off
REM FT-DEP-001 Batch 4 — safe database backup (mysqldump).
REM Does NOT restore, migrate, delete old backups, or print passwords.
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "NODE_SCRIPT=%SCRIPT_DIR%backup-db.js"

if not exist "%NODE_SCRIPT%" (
  echo [backup-db] ERROR: backup-db.js not found beside this script.
  echo             Expected: %NODE_SCRIPT%
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [backup-db] ERROR: node is not on PATH.
  exit /b 1
)

echo [backup-db] Starting Flowtix database backup...
call node "%NODE_SCRIPT%" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo [backup-db] Backup failed with exit code %RC%.
  exit /b %RC%
)
echo [backup-db] Backup completed successfully.
exit /b 0
