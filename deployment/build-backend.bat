@echo off
REM FT-DEP-001 Batch 1 — Phase A backend package (no esbuild).
REM Copies runtime sources + package manifests. Excludes tests, docs, .git, caches, .env.
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul 2>&1
if errorlevel 1 (
  echo [build-backend] ERROR: cannot resolve repo root.
  exit /b 1
)
set "ROOT=%CD%"
popd >nul

if not defined PRODUCT_VERSION (
  for /f "usebackq delims=" %%V in (`node -p "require('./backend/package.json').version" 2^>nul`) do set "PRODUCT_VERSION=%%V"
)
if not defined PRODUCT_VERSION set "PRODUCT_VERSION=1.0.0"
if not defined RELEASE_NAME set "RELEASE_NAME=Flowtix-v%PRODUCT_VERSION%"
if not defined RELEASE_DIR set "RELEASE_DIR=%ROOT%\release\%RELEASE_NAME%"

set "APP_DIR=%RELEASE_DIR%\app"
set "BACKEND_DIR=%ROOT%\backend"

echo [build-backend] Product version: %PRODUCT_VERSION%
echo [build-backend] Target app dir:  %APP_DIR%

if not exist "%BACKEND_DIR%\package.json" (
  echo [build-backend] ERROR: backend\package.json not found.
  exit /b 1
)
if not exist "%BACKEND_DIR%\src\server.js" (
  echo [build-backend] ERROR: backend\src\server.js not found.
  exit /b 1
)

if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"
if exist "%APP_DIR%" rmdir /s /q "%APP_DIR%"
mkdir "%APP_DIR%"
mkdir "%APP_DIR%\src"

echo [build-backend] Copying package manifests...
copy /Y "%BACKEND_DIR%\package.json" "%APP_DIR%\package.json" >nul
if exist "%BACKEND_DIR%\package-lock.json" copy /Y "%BACKEND_DIR%\package-lock.json" "%APP_DIR%\package-lock.json" >nul

echo [build-backend] Copying runtime src\ (exclude *.test.js / *.spec.js)...
robocopy "%BACKEND_DIR%\src" "%APP_DIR%\src" /E /NFL /NDL /NJH /NJS /nc /ns /np /XF *.test.js *.spec.js *.md >nul
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  echo [build-backend] ERROR: robocopy src failed with code %RC%.
  exit /b 1
)

REM Optional env template only — never copy live .env secrets into the package.
if exist "%BACKEND_DIR%\.env.example" (
  copy /Y "%BACKEND_DIR%\.env.example" "%APP_DIR%\.env.example" >nul
) else if exist "%BACKEND_DIR%\env.example" (
  copy /Y "%BACKEND_DIR%\env.example" "%APP_DIR%\.env.example" >nul
)

REM Phase A: do not ship developer node_modules, test/, scripts/, docs, logs, .git
echo [build-backend] Writing app\README.txt ...
> "%APP_DIR%\README.txt" (
  echo Flowtix ERP — backend runtime package ^(FT-DEP-001 Batch 1 / Phase A^)
  echo.
  echo Start:  npm ci --omit=dev   then   npm start
  echo Or:     npm install --omit=dev   then   npm start
  echo.
  echo Prisma client: run "npx prisma generate" from the release prisma folder
  echo after DATABASE_URL is configured ^(see shared\.env.example^).
  echo.
  echo Excluded from this package: test\, scripts\, docs\, .git\, node_modules\, .env
)

if not exist "%APP_DIR%\src\server.js" (
  echo [build-backend] ERROR: app\src\server.js missing after copy.
  exit /b 1
)
if exist "%APP_DIR%\test" (
  echo [build-backend] ERROR: test\ must not be present in app\.
  exit /b 1
)
if exist "%APP_DIR%\node_modules" (
  echo [build-backend] ERROR: node_modules must not be copied into app\.
  exit /b 1
)
if exist "%APP_DIR%\.env" (
  echo [build-backend] ERROR: .env must not be copied into app\.
  exit /b 1
)

echo [build-backend] Done.
exit /b 0
