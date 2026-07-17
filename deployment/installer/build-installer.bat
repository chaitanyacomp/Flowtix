@echo off
REM FT-DEP-001 Batch 10 — build Flowtix Windows installer (Inno Setup 6).
REM Prerequisite: release package from deployment\create-release.bat
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "ROOT=%SCRIPT_DIR%..\.."
set "DEPLOY=%SCRIPT_DIR%.."
set "ISS=%SCRIPT_DIR%Flowtix.iss"
set "OUT=%SCRIPT_DIR%output"

REM Resolve product version from backend package.json (fallback 1.0.0)
set "PRODUCT_VERSION=1.0.0"
for /f "usebackq delims=" %%V in (`node -e "try{console.log(require('%ROOT%\\backend\\package.json').version||'1.0.0')}catch(e){console.log('1.0.0')}"`) do set "PRODUCT_VERSION=%%V"

set "RELEASE_DIR=%ROOT%\release\Flowtix-v%PRODUCT_VERSION%"
if not exist "%RELEASE_DIR%\VERSION.txt" (
  echo [build-installer] Release package missing: %RELEASE_DIR%
  echo [build-installer] Run deployment\create-release.bat first.
  exit /b 1
)
if not exist "%RELEASE_DIR%\tools\setup-flowtix.bat" (
  echo [build-installer] ERROR: setup-flowtix.bat missing in release tools — rebuild release ^(Batch 9+^).
  exit /b 1
)

set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if "%ISCC%"=="" (
  echo [build-installer] ERROR: Inno Setup 6 not found ^(ISCC.exe^).
  echo Install from https://jrsoftware.org/isinfo.php
  exit /b 1
)

echo [build-installer] ISCC=%ISCC%
echo [build-installer] VERSION=%PRODUCT_VERSION%
echo [build-installer] RELEASE=%RELEASE_DIR%
echo [build-installer] OUTPUT=%OUT%

if not exist "%OUT%" mkdir "%OUT%" >nul 2>&1

REM Pass ReleaseRoot as absolute path for ISCC compile-time Source embedding ONLY.
REM Flowtix.iss must not probe ReleaseRoot at customer runtime (portability).
echo [build-installer] Embedding release into setup EXE ^(build-time path, not runtime^)...
call "%ISCC%" "/DMyAppVersion=%PRODUCT_VERSION%" "/DReleaseRoot=%RELEASE_DIR%" "/DOutputDir=%OUT%" "%ISS%"
if errorlevel 1 (
  echo [build-installer] ISCC failed.
  exit /b 1
)

REM Regression: compiled EXE must not contain this machine's repo path.
findstr /I /C:"%ROOT%" "%OUT%\Flowtix-Setup-v%PRODUCT_VERSION%.exe" >nul 2>&1
if not errorlevel 1 (
  echo [build-installer] ERROR: compiled installer still contains developer repo path:
  echo   %ROOT%
  echo   Fix Flowtix.iss — ReleaseRoot must not be used at runtime.
  exit /b 1
)
echo [build-installer] OK: no developer ROOT path string in setup EXE.

echo.
echo [build-installer] SUCCESS
dir /b "%OUT%\Flowtix-Setup-v*.exe"
echo.
echo Silent example:
echo   Flowtix-Setup-v%PRODUCT_VERSION%.exe /VERYSILENT /DIR="C:\FT-ERP" /TASKS="!skipmigrate"
echo   ^(create shared\.env before Path A; use /TASKS="installservice" for WinSW^)
echo.
exit /b 0
