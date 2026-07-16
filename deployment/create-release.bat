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

REM --- 6. tools\ (Batch 4–11 + Milestone 2: firewall, WinSW validate) ---
echo [create-release] Validating offline WinSW package...
call node "%DEPLOY%\validate-winsw.js" --require
if errorlevel 1 (
  echo [create-release] ERROR: WinSW offline packaging failed validation.
  echo [create-release] Place checksum-verified WinSW-x64.exe per deployment\vendor\winsw\README.txt
  exit /b 1
)

echo [create-release] Copying tools\ scripts ^(Batches 4–11 / Milestone 2^)...
copy /Y "%DEPLOY%\backup-db.bat" "%RELEASE_DIR%\tools\backup-db.bat" >nul
copy /Y "%DEPLOY%\backup-db.js" "%RELEASE_DIR%\tools\backup-db.js" >nul
copy /Y "%DEPLOY%\migrate-db.bat" "%RELEASE_DIR%\tools\migrate-db.bat" >nul
copy /Y "%DEPLOY%\migrate-db.js" "%RELEASE_DIR%\tools\migrate-db.js" >nul
copy /Y "%DEPLOY%\update-flowtix.bat" "%RELEASE_DIR%\tools\update-flowtix.bat" >nul
copy /Y "%DEPLOY%\update-flowtix.js" "%RELEASE_DIR%\tools\update-flowtix.js" >nul
copy /Y "%DEPLOY%\rollback-flowtix.bat" "%RELEASE_DIR%\tools\rollback-flowtix.bat" >nul
copy /Y "%DEPLOY%\rollback-flowtix.js" "%RELEASE_DIR%\tools\rollback-flowtix.js" >nul
copy /Y "%DEPLOY%\service-control.js" "%RELEASE_DIR%\tools\service-control.js" >nul
copy /Y "%DEPLOY%\service-manage.js" "%RELEASE_DIR%\tools\service-manage.js" >nul
copy /Y "%DEPLOY%\service-install.bat" "%RELEASE_DIR%\tools\service-install.bat" >nul
copy /Y "%DEPLOY%\service-uninstall.bat" "%RELEASE_DIR%\tools\service-uninstall.bat" >nul
copy /Y "%DEPLOY%\service-start.bat" "%RELEASE_DIR%\tools\service-start.bat" >nul
copy /Y "%DEPLOY%\service-stop.bat" "%RELEASE_DIR%\tools\service-stop.bat" >nul
copy /Y "%DEPLOY%\service-restart.bat" "%RELEASE_DIR%\tools\service-restart.bat" >nul
copy /Y "%DEPLOY%\service-status.bat" "%RELEASE_DIR%\tools\service-status.bat" >nul
copy /Y "%DEPLOY%\setup-flowtix.bat" "%RELEASE_DIR%\tools\setup-flowtix.bat" >nul
copy /Y "%DEPLOY%\setup-flowtix.js" "%RELEASE_DIR%\tools\setup-flowtix.js" >nul
copy /Y "%DEPLOY%\check-prereqs.bat" "%RELEASE_DIR%\tools\check-prereqs.bat" >nul
copy /Y "%DEPLOY%\check-prereqs.js" "%RELEASE_DIR%\tools\check-prereqs.js" >nul
copy /Y "%DEPLOY%\init-folders.bat" "%RELEASE_DIR%\tools\init-folders.bat" >nul
copy /Y "%DEPLOY%\init-folders.js" "%RELEASE_DIR%\tools\init-folders.js" >nul
copy /Y "%DEPLOY%\verify-install.bat" "%RELEASE_DIR%\tools\verify-install.bat" >nul
copy /Y "%DEPLOY%\verify-install.js" "%RELEASE_DIR%\tools\verify-install.js" >nul
copy /Y "%DEPLOY%\firewall-flowtix.bat" "%RELEASE_DIR%\tools\firewall-flowtix.bat" >nul
copy /Y "%DEPLOY%\firewall-flowtix.js" "%RELEASE_DIR%\tools\firewall-flowtix.js" >nul
copy /Y "%DEPLOY%\validate-winsw.js" "%RELEASE_DIR%\tools\validate-winsw.js" >nul
copy /Y "%DEPLOY%\install-common.js" "%RELEASE_DIR%\tools\install-common.js" >nul
copy /Y "%DEPLOY%\install-validate.bat" "%RELEASE_DIR%\tools\install-validate.bat" >nul
copy /Y "%DEPLOY%\install-validate.js" "%RELEASE_DIR%\tools\install-validate.js" >nul
copy /Y "%DEPLOY%\configure-env.bat" "%RELEASE_DIR%\tools\configure-env.bat" >nul
copy /Y "%DEPLOY%\configure-env.js" "%RELEASE_DIR%\tools\configure-env.js" >nul
copy /Y "%DEPLOY%\db-safety.bat" "%RELEASE_DIR%\tools\db-safety.bat" >nul
copy /Y "%DEPLOY%\db-safety.js" "%RELEASE_DIR%\tools\db-safety.js" >nul
copy /Y "%DEPLOY%\install-recovery.bat" "%RELEASE_DIR%\tools\install-recovery.bat" >nul
copy /Y "%DEPLOY%\install-recovery.js" "%RELEASE_DIR%\tools\install-recovery.js" >nul
copy /Y "%DEPLOY%\collect-diagnostics.bat" "%RELEASE_DIR%\tools\collect-diagnostics.bat" >nul
copy /Y "%DEPLOY%\collect-diagnostics.js" "%RELEASE_DIR%\tools\collect-diagnostics.js" >nul
copy /Y "%DEPLOY%\certify-install.bat" "%RELEASE_DIR%\tools\certify-install.bat" >nul
copy /Y "%DEPLOY%\certify-install.js" "%RELEASE_DIR%\tools\certify-install.js" >nul
if exist "%DEPLOY%\production.env.example" (
  mkdir "%RELEASE_DIR%\shared" 2>nul
  copy /Y "%DEPLOY%\production.env.example" "%RELEASE_DIR%\shared\.env.example" >nul
)
REM Offline WinSW — validated above; always ship binary + manifest into release tools
mkdir "%RELEASE_DIR%\tools\vendor\winsw" 2>nul
copy /Y "%DEPLOY%\vendor\winsw\WinSW-x64.exe" "%RELEASE_DIR%\tools\vendor\winsw\WinSW-x64.exe" >nul
if errorlevel 1 (
  echo [create-release] ERROR: WinSW-x64.exe copy failed.
  exit /b 1
)
copy /Y "%DEPLOY%\vendor\winsw\winsw-manifest.json" "%RELEASE_DIR%\tools\vendor\winsw\winsw-manifest.json" >nul
copy /Y "%DEPLOY%\vendor\winsw\README.txt" "%RELEASE_DIR%\tools\vendor\winsw\README.txt" >nul

REM --- 6b. docs\handover\ (Batch 11 — client handover pack) ---
echo [create-release] Copying docs\handover\ ^(Batch 11^)...
set "HANDOVER_SRC=%ROOT%\docs\product\06_Deployment\handover"
if not exist "%HANDOVER_SRC%\README.md" (
  echo [create-release] ERROR: handover pack missing at %HANDOVER_SRC%
  exit /b 1
)
mkdir "%RELEASE_DIR%\docs\handover" 2>nul
robocopy "%HANDOVER_SRC%" "%RELEASE_DIR%\docs\handover" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  echo [create-release] ERROR: handover robocopy failed with code %RC%.
  exit /b 1
)

> "%RELEASE_DIR%\tools\README.txt" (
  echo Flowtix ERP — release tools ^(FT-DEP-001^)
  echo.
  echo Batch 4:
  echo   backup-db.bat / backup-db.js  — safe mysqldump to backups\db\
  echo.
  echo Batch 5:
  echo   migrate-db.bat / migrate-db.js — prisma migrate deploy ^(backup-gated^)
  echo.
  echo Batch 6:
  echo   update-flowtix.bat / update-flowtix.js — one-click update orchestrator
  echo.
  echo Batch 7:
  echo   rollback-flowtix.bat / rollback-flowtix.js — app/web rollback from archive
  echo.
  echo Batch 8:
  echo   service-install/uninstall/start/stop/restart/status.bat — optional WinSW service
  echo.
  echo Batch 9:
  echo   setup-flowtix.bat / check-prereqs.bat / init-folders.bat — client setup bootstrap
  echo   ^(not MSI; does not overwrite shared\.env; Path A migrate or --skip-migrate^)
  echo.
  echo Batch 11 / Milestone 2:
  echo   verify-install.bat — API health + UI HTML shell checks
  echo   firewall-flowtix.bat — optional inbound TCP rule for app PORT
  echo   vendor\winsw\ — offline WinSW-x64.exe ^(checksum validated^)
  echo   docs\handover\ — production readiness, checklists, runbook, templates
  echo.
  echo Milestone 3 — installation hardening:
  echo   install-validate.bat — pre-install environment validation report
  echo   configure-env.bat — guided production .env ^(secrets masked^)
  echo   db-safety.bat — MySQL safety gate before migrate deploy
  echo   install-recovery.bat — install transaction begin/abort/commit
  echo   collect-diagnostics.bat — ZIP-ready diagnostics bundle
  echo   certify-install.bat — clean-machine certification harness ^(lab^)
  echo.
  echo Deferred:
  echo   - automated DB restore
  echo   - MSI / WiX ^(Inno Setup: deployment\installer\build-installer.bat^)
  echo   - bundled MySQL installer
)

echo.
echo [create-release] Optional next step ^(Batch 10^):
echo   deployment\installer\build-installer.bat
echo.

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

if not exist "%RELEASE_DIR%\tools\migrate-db.bat" (
  echo   FAIL: tools\migrate-db.bat missing
  set "FAIL=1"
) else (
  echo   OK: tools\migrate-db.bat
)

if not exist "%RELEASE_DIR%\tools\migrate-db.js" (
  echo   FAIL: tools\migrate-db.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\migrate-db.js
)

if not exist "%RELEASE_DIR%\tools\update-flowtix.bat" (
  echo   FAIL: tools\update-flowtix.bat missing
  set "FAIL=1"
) else (
  echo   OK: tools\update-flowtix.bat
)

if not exist "%RELEASE_DIR%\tools\update-flowtix.js" (
  echo   FAIL: tools\update-flowtix.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\update-flowtix.js
)

if not exist "%RELEASE_DIR%\tools\rollback-flowtix.bat" (
  echo   FAIL: tools\rollback-flowtix.bat missing
  set "FAIL=1"
) else (
  echo   OK: tools\rollback-flowtix.bat
)

if not exist "%RELEASE_DIR%\tools\rollback-flowtix.js" (
  echo   FAIL: tools\rollback-flowtix.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\rollback-flowtix.js
)

if not exist "%RELEASE_DIR%\tools\service-control.js" (
  echo   FAIL: tools\service-control.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\service-control.js
)

if not exist "%RELEASE_DIR%\tools\service-install.bat" (
  echo   FAIL: tools\service-install.bat missing
  set "FAIL=1"
) else (
  echo   OK: tools\service-install.bat
)

if not exist "%RELEASE_DIR%\tools\service-status.bat" (
  echo   FAIL: tools\service-status.bat missing
  set "FAIL=1"
) else (
  echo   OK: tools\service-status.bat
)

if not exist "%RELEASE_DIR%\tools\setup-flowtix.bat" (
  echo   FAIL: tools\setup-flowtix.bat missing
  set "FAIL=1"
) else (
  echo   OK: tools\setup-flowtix.bat
)

if not exist "%RELEASE_DIR%\tools\check-prereqs.js" (
  echo   FAIL: tools\check-prereqs.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\check-prereqs.js
)

if not exist "%RELEASE_DIR%\tools\init-folders.js" (
  echo   FAIL: tools\init-folders.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\init-folders.js
)

if not exist "%RELEASE_DIR%\tools\verify-install.bat" (
  echo   FAIL: tools\verify-install.bat missing
  set "FAIL=1"
) else (
  echo   OK: tools\verify-install.bat
)

if not exist "%RELEASE_DIR%\tools\verify-install.js" (
  echo   FAIL: tools\verify-install.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\verify-install.js
)

if not exist "%RELEASE_DIR%\tools\firewall-flowtix.js" (
  echo   FAIL: tools\firewall-flowtix.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\firewall-flowtix.js
)

if not exist "%RELEASE_DIR%\tools\install-validate.js" (
  echo   FAIL: tools\install-validate.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\install-validate.js
)

if not exist "%RELEASE_DIR%\tools\configure-env.js" (
  echo   FAIL: tools\configure-env.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\configure-env.js
)

if not exist "%RELEASE_DIR%\tools\db-safety.js" (
  echo   FAIL: tools\db-safety.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\db-safety.js
)

if not exist "%RELEASE_DIR%\tools\install-recovery.js" (
  echo   FAIL: tools\install-recovery.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\install-recovery.js
)

if not exist "%RELEASE_DIR%\tools\collect-diagnostics.js" (
  echo   FAIL: tools\collect-diagnostics.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\collect-diagnostics.js
)

if not exist "%RELEASE_DIR%\tools\certify-install.js" (
  echo   FAIL: tools\certify-install.js missing
  set "FAIL=1"
) else (
  echo   OK: tools\certify-install.js
)

if not exist "%RELEASE_DIR%\tools\vendor\winsw\WinSW-x64.exe" (
  echo   FAIL: tools\vendor\winsw\WinSW-x64.exe missing ^(offline service blocker^)
  set "FAIL=1"
) else (
  echo   OK: tools\vendor\winsw\WinSW-x64.exe
)

if not exist "%RELEASE_DIR%\tools\vendor\winsw\winsw-manifest.json" (
  echo   FAIL: winsw-manifest.json missing
  set "FAIL=1"
) else (
  echo   OK: winsw-manifest.json
)

if not exist "%RELEASE_DIR%\docs\handover\README.md" (
  echo   FAIL: docs\handover\README.md missing
  set "FAIL=1"
) else (
  echo   OK: docs\handover\README.md
)

if not exist "%RELEASE_DIR%\docs\handover\FT-DEP-011_Production_Readiness.md" (
  echo   FAIL: docs\handover\FT-DEP-011_Production_Readiness.md missing
  set "FAIL=1"
) else (
  echo   OK: docs\handover\FT-DEP-011
)

if not exist "%RELEASE_DIR%\docs\handover\FT-DEP-012_Administrator_Runbook.md" (
  echo   FAIL: docs\handover\FT-DEP-012_Administrator_Runbook.md missing
  set "FAIL=1"
) else (
  echo   OK: docs\handover\FT-DEP-012
)

if not exist "%RELEASE_DIR%\docs\handover\checklists\01_Production_Deployment.md" (
  echo   FAIL: docs\handover\checklists\01 missing
  set "FAIL=1"
) else (
  echo   OK: docs\handover\checklists
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
