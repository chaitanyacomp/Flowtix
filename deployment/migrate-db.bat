@echo off
REM FT-DEP-001 Batch 5 — safe Prisma migrate deploy (mandatory backup gate).
REM Does NOT restore, seed, reset, db push, migrate dev, or print passwords.
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "NODE_SCRIPT=%SCRIPT_DIR%migrate-db.js"

if not exist "%NODE_SCRIPT%" (
  echo [migrate-db] ERROR: migrate-db.js not found beside this script.
  echo               Expected: %NODE_SCRIPT%
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [migrate-db] ERROR: node is not on PATH.
  exit /b 1
)

echo [migrate-db] Starting Flowtix Prisma migrate deploy...
call node "%NODE_SCRIPT%" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo [migrate-db] Migration failed with exit code %RC%.
  exit /b %RC%
)
echo [migrate-db] Migration completed successfully.
exit /b 0
