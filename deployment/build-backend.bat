@echo off
REM FT-DEP-001 Batch 3 — esbuild-bundled backend into release/.../app/server.js
REM Does not copy raw src/. Prisma generated client is copied beside the bundle.
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul 2>&1
if errorlevel 1 (
  echo [build-backend] ERROR: cannot resolve repo root.
  exit /b 1
)
set "ROOT=%CD%"
popd >nul

cd /d "%ROOT%"

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
echo [build-backend] Mode:            Batch 3 esbuild bundle

if not exist "%BACKEND_DIR%\package.json" (
  echo [build-backend] ERROR: backend\package.json not found.
  exit /b 1
)
if not exist "%BACKEND_DIR%\src\server.js" (
  echo [build-backend] ERROR: backend\src\server.js not found.
  exit /b 1
)

REM Ensure Prisma client exists for copy into release app/
if not exist "%BACKEND_DIR%\prisma\generated\client-v2" (
  echo [build-backend] Generating Prisma client...
  pushd "%BACKEND_DIR%"
  call npx --yes prisma generate
  if errorlevel 1 (
    echo [build-backend] ERROR: prisma generate failed.
    popd
    exit /b 1
  )
  popd
)

if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"
if exist "%APP_DIR%" rmdir /s /q "%APP_DIR%"
mkdir "%APP_DIR%"

set "RELEASE_DIR=%RELEASE_DIR%"
set "PRODUCT_VERSION=%PRODUCT_VERSION%"
call node "%ROOT%\deployment\bundle-backend.js" --out "%APP_DIR%" --version "%PRODUCT_VERSION%"
if errorlevel 1 (
  echo [build-backend] ERROR: bundle-backend.js failed.
  exit /b 1
)

if not exist "%APP_DIR%\server.js" (
  echo [build-backend] ERROR: app\server.js missing after bundle.
  exit /b 1
)
if exist "%APP_DIR%\src" (
  echo [build-backend] ERROR: app\src must not be present after Batch 3 bundling.
  exit /b 1
)
if not exist "%APP_DIR%\package.json" (
  echo [build-backend] ERROR: app\package.json missing.
  exit /b 1
)
if not exist "%APP_DIR%\prisma\generated\client-v2" (
  echo [build-backend] ERROR: app\prisma\generated\client-v2 missing.
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
