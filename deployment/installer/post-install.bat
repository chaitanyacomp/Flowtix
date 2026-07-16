@echo off
REM FT-DEP-001 Batch 10 / Milestone 2 — post-install wrapper.
REM Args: %1=FT_ERP_HOME  %2=SOURCE_RELEASE_DIR  %3=skip-migrate(0|1)  %4=install-service(0|1)  %5=configure-firewall(0|1)
setlocal EnableExtensions

set "HOME=%~1"
set "SOURCE=%~2"
set "SKIP_MIGRATE=%~3"
set "INSTALL_SERVICE=%~4"
set "CONFIGURE_FIREWALL=%~5"

if "%HOME%"=="" (
  echo [post-install] ERROR: FT_ERP_HOME not provided.
  exit /b 1
)
if "%SOURCE%"=="" (
  echo [post-install] ERROR: source release dir not provided.
  exit /b 1
)
if not exist "%SOURCE%\tools\setup-flowtix.bat" (
  echo [post-install] ERROR: setup-flowtix.bat missing under "%SOURCE%\tools\"
  exit /b 1
)

if not exist "%HOME%\logs" mkdir "%HOME%\logs" >nul 2>&1
set "LOG=%HOME%\logs\installer-post.log"
>>"%LOG%" echo ===== %DATE% %TIME% post-install =====
>>"%LOG%" echo HOME=%HOME%
>>"%LOG%" echo SOURCE=%SOURCE%
>>"%LOG%" echo SKIP_MIGRATE=%SKIP_MIGRATE% INSTALL_SERVICE=%INSTALL_SERVICE% CONFIGURE_FIREWALL=%CONFIGURE_FIREWALL%

REM Existing install: do not destructively re-bootstrap (Batch 9 / FT-DEP-001).
if exist "%HOME%\shared\.env" if exist "%HOME%\app\server.js" if exist "%HOME%\web\index.html" (
  echo [post-install] Existing install detected — skipping setup-flowtix.
  echo [post-install] Use tools\update-flowtix.bat for upgrades ^(Batch 6^).
  >>"%LOG%" echo EXISTING_INSTALL_SKIP_SETUP
  exit /b 0
)

set "EXTRA="
if "%SKIP_MIGRATE%"=="1" set "EXTRA=%EXTRA% --skip-migrate"
if "%INSTALL_SERVICE%"=="1" (
  set "EXTRA=%EXTRA% --install-service"
) else (
  set "EXTRA=%EXTRA% --skip-service"
)
if "%CONFIGURE_FIREWALL%"=="1" (
  set "EXTRA=%EXTRA% --configure-firewall"
) else (
  set "EXTRA=%EXTRA% --skip-firewall"
)

echo [post-install] Running Batch 9 setup-flowtix...
>>"%LOG%" echo CMD=setup-flowtix.bat --yes --home ... --source ...%EXTRA%
call "%SOURCE%\tools\setup-flowtix.bat" --yes --home "%HOME%" --source "%SOURCE%"%EXTRA%
set "RC=%ERRORLEVEL%"
>>"%LOG%" echo SETUP_EXIT=%RC%
if not "%RC%"=="0" (
  echo [post-install] setup-flowtix failed with exit %RC%. See logs\setup.log
  exit /b %RC%
)

echo [post-install] Setup completed.
exit /b 0
