@echo off
REM FT-DEP-001 — assemble Flowtix release (Batch 1 packaging + Batch 3 esbuild backend)
REM Does NOT implement: Windows Service, installer, backup/update scripts, Docker, pkg, nexe.
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul 2>&1
if errorlevel 1 (
  echo [create-release] ERROR: cannot resolve repo root.
  exit /b 1
)
set "ROOT=%CD%"
popd >nul

cd /d "%ROOT%"

for /f "usebackq delims=" %%V in (`node -p "require('./backend/package.json').version"`) do set "PRODUCT_VERSION=%%V"
if not defined PRODUCT_VERSION (
  echo [create-release] ERROR: could not read backend package version.
  exit /b 1
)

set "RELEASE_NAME=Flowtix-v%PRODUCT_VERSION%"
set "RELEASE_ROOT=%ROOT%\release"
set "RELEASE_DIR=%RELEASE_ROOT%\%RELEASE_NAME%"
set "DEPLOY=%ROOT%\deployment"

echo ============================================================
echo  Flowtix ERP — Create Release  %RELEASE_NAME%
echo  FT-DEP-001 Batch 1+3 ^(web + esbuild backend^)
echo ============================================================
echo.

REM --- 1. Clean previous release output ---
call "%DEPLOY%\clean-release.bat"
if errorlevel 1 exit /b 1

mkdir "%RELEASE_DIR%" 2>nul
mkdir "%RELEASE_DIR%\app" 2>nul
mkdir "%RELEASE_DIR%\web" 2>nul
mkdir "%RELEASE_DIR%\prisma" 2>nul
mkdir "%RELEASE_DIR%\prisma\migrations" 2>nul
mkdir "%RELEASE_DIR%\shared" 2>nul
mkdir "%RELEASE_DIR%\tools" 2>nul

REM --- 2. Frontend ---
call "%DEPLOY%\build-frontend.bat"
if errorlevel 1 exit /b 1

REM --- 3. Backend ---
call "%DEPLOY%\build-backend.bat"
if errorlevel 1 exit /b 1

REM --- 4. Prisma schema + migrations only ---
echo [create-release] Copying prisma schema and migrations...
copy /Y "%ROOT%\backend\prisma\schema.prisma" "%RELEASE_DIR%\prisma\schema.prisma" >nul
if errorlevel 1 (
  echo [create-release] ERROR: schema.prisma copy failed.
  exit /b 1
)
robocopy "%ROOT%\backend\prisma\migrations" "%RELEASE_DIR%\prisma\migrations" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  echo [create-release] ERROR: migrations robocopy failed with code %RC%.
  exit /b 1
)

REM Do not ship seed / reset / generated client / cleanup scripts in prisma\
if exist "%RELEASE_DIR%\prisma\seed.js" del /f /q "%RELEASE_DIR%\prisma\seed.js" >nul 2>&1
if exist "%RELEASE_DIR%\prisma\generated" rmdir /s /q "%RELEASE_DIR%\prisma\generated" >nul 2>&1
if exist "%RELEASE_DIR%\prisma\reset-business-data.js" del /f /q "%RELEASE_DIR%\prisma\reset-business-data.js" >nul 2>&1
if exist "%RELEASE_DIR%\prisma\cleanup-workorders-null-sales-order.js" del /f /q "%RELEASE_DIR%\prisma\cleanup-workorders-null-sales-order.js" >nul 2>&1

REM --- 5. shared\ template (no secrets) ---
echo [create-release] Writing shared\ templates...
if exist "%ROOT%\backend\.env.example" (
  copy /Y "%ROOT%\backend\.env.example" "%RELEASE_DIR%\shared\.env.example" >nul
) else if exist "%ROOT%\backend\env.example" (
  copy /Y "%ROOT%\backend\env.example" "%RELEASE_DIR%\shared\.env.example" >nul
)
if exist "%ROOT%\deployment\production.env.example" (
  copy /Y "%ROOT%\deployment\production.env.example" "%RELEASE_DIR%\shared\production.env.example" >nul
)
> "%RELEASE_DIR%\shared\README.txt" (
  echo Client-specific files live here on the server ^(FT-DEP-001^):
  echo   .env          — secrets / DATABASE_URL ^(create from .env.example; never commit^)
  echo   uploads\      — optional disk uploads
  echo.
  echo This release package ships templates only. Do not place production secrets in git.
)

REM --- 6. tools\ (Batch 4 backup scripts; update/rollback still deferred) ---
echo [create-release] Copying tools\ backup scripts...
copy /Y "%DEPLOY%\backup-db.bat" "%RELEASE_DIR%\tools\backup-db.bat" >nul
copy /Y "%DEPLOY%\backup-db.js" "%RELEASE_DIR%\tools\backup-db.js" >nul
> "%RELEASE_DIR%\tools\README.txt" (
  echo Flowtix ERP — release tools ^(FT-DEP-001^)
  echo.
  echo Batch 4:
  echo   backup-db.bat / backup-db.js  — safe mysqldump to backups\db\
  echo.
  echo Deferred:
  echo   - restore
  echo   - update / rollback helpers
  echo   - Windows Service wrappers
)

REM --- 7. Git commit + build date ---
set "GIT_COMMIT=unknown"
for /f "usebackq delims=" %%G in (`git -C "%ROOT%" rev-parse --short HEAD 2^>nul`) do set "GIT_COMMIT=%%G"

for /f "usebackq delims=" %%D in (`node -e "console.log(new Date().toISOString())"`) do set "BUILD_DATE=%%D"

REM --- 8. VERSION.txt + RELEASE_NOTES.md via Node helper (UTF-8; resolves migration head) ---
echo [create-release] Writing VERSION.txt and RELEASE_NOTES.md ...
set "OUT_DIR=%RELEASE_DIR%"
set "ROOT=%ROOT%"
call node "%DEPLOY%\write-release-meta.js"
if errorlevel 1 (
  echo [create-release] ERROR: write-release-meta.js failed.
  exit /b 1
)

REM --- 10. Validation ---
echo.
echo [create-release] Validating package...
set "FAIL=0"

if not exist "%RELEASE_DIR%\web\index.html" (
  echo   FAIL: web\index.html missing
  set "FAIL=1"
) else (
  echo   OK: web\index.html
)

if not exist "%RELEASE_DIR%\app\server.js" (
  echo   FAIL: app\server.js missing ^(Batch 3 bundle^)
  set "FAIL=1"
) else (
  echo   OK: app\server.js
)

if exist "%RELEASE_DIR%\app\src" (
  echo   FAIL: app\src must not ship after Batch 3 bundling
  set "FAIL=1"
) else (
  echo   OK: no app\src
)

if not exist "%RELEASE_DIR%\app\package.json" (
  echo   FAIL: app\package.json missing
  set "FAIL=1"
) else (
  echo   OK: app\package.json
)

if not exist "%RELEASE_DIR%\app\prisma\generated\client-v2" (
  echo   FAIL: app\prisma\generated\client-v2 missing
  set "FAIL=1"
) else (
  echo   OK: app\prisma\generated\client-v2
)

if not exist "%RELEASE_DIR%\prisma\schema.prisma" (
  echo   FAIL: prisma\schema.prisma missing
  set "FAIL=1"
) else (
  echo   OK: prisma\schema.prisma
)

if not exist "%RELEASE_DIR%\prisma\migrations" (
  echo   FAIL: prisma\migrations missing
  set "FAIL=1"
) else (
  echo   OK: prisma\migrations
)

if not exist "%RELEASE_DIR%\VERSION.txt" (
  echo   FAIL: VERSION.txt missing
  set "FAIL=1"
) else (
  echo   OK: VERSION.txt
)

if not exist "%RELEASE_DIR%\RELEASE_NOTES.md" (
  echo   FAIL: RELEASE_NOTES.md missing
  set "FAIL=1"
) else (
  echo   OK: RELEASE_NOTES.md
)

if exist "%RELEASE_DIR%\app\test" (
  echo   FAIL: development test\ copied into app\
  set "FAIL=1"
) else (
  echo   OK: no app\test
)

if exist "%RELEASE_DIR%\app\node_modules" (
  echo   FAIL: node_modules copied into app\
  set "FAIL=1"
) else (
  echo   OK: no app\node_modules
)

if exist "%RELEASE_DIR%\app\.env" (
  echo   FAIL: .env secrets copied into app\
  set "FAIL=1"
) else (
  echo   OK: no app\.env
)

if exist "%RELEASE_DIR%\app\scripts" (
  echo   FAIL: backend scripts\ copied into app\
  set "FAIL=1"
) else (
  echo   OK: no app\scripts
)

if exist "%RELEASE_DIR%\prisma\seed.js" (
  echo   FAIL: prisma seed.js must not ship in release package
  set "FAIL=1"
) else (
  echo   OK: no prisma\seed.js
)

if not exist "%RELEASE_DIR%\tools\backup-db.bat" (
  echo   FAIL: tools\backup-db.bat missing
  set "FAIL=1"
) else (
  echo   OK: tools\backup-db.bat
)

if not exist "%RELEASE_DIR%\tools\backup-db.js" (
  echo   FAIL: tools\backup-db.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\backup-db.js
)

if "%FAIL%"=="1" (
  echo.
  echo [create-release] VALIDATION FAILED.
  exit /b 1
)

echo.
echo [create-release] SUCCESS: %RELEASE_DIR%
echo.
exit /b 0
