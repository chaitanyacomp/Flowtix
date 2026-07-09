@echo off
REM FT-DEP-001 Batch 1 — production frontend build (Vite) into release/.../web
REM Uses `npx vite build` (production assets). Full `npm run build` includes tsc -b;
REM typecheck failures elsewhere in the repo must not block packaging in Batch 1.
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul 2>&1
if errorlevel 1 (
  echo [build-frontend] ERROR: cannot resolve repo root.
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

set "WEB_DIR=%RELEASE_DIR%\web"
set "FRONTEND_DIR=%ROOT%\frontend"
set "DIST_DIR=%FRONTEND_DIR%\dist"

echo [build-frontend] Product version: %PRODUCT_VERSION%
echo [build-frontend] Target web dir:  %WEB_DIR%

if not exist "%FRONTEND_DIR%\package.json" (
  echo [build-frontend] ERROR: frontend\package.json not found.
  exit /b 1
)

pushd "%FRONTEND_DIR%"
echo [build-frontend] Running Vite production build...
call npx --yes vite build
if errorlevel 1 (
  echo [build-frontend] ERROR: vite build failed.
  popd
  exit /b 1
)
popd

if not exist "%DIST_DIR%\index.html" (
  echo [build-frontend] ERROR: dist\index.html missing after build.
  exit /b 1
)

if not exist "%RELEASE_DIR%" mkdir "%RELEASE_DIR%"
if exist "%WEB_DIR%" rmdir /s /q "%WEB_DIR%"
mkdir "%WEB_DIR%"

echo [build-frontend] Copying production assets to web\ ...
robocopy "%DIST_DIR%" "%WEB_DIR%" /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  echo [build-frontend] ERROR: robocopy failed with code %RC%.
  exit /b 1
)

if not exist "%WEB_DIR%\index.html" (
  echo [build-frontend] ERROR: web\index.html missing after copy.
  exit /b 1
)

echo [build-frontend] Done.
exit /b 0
