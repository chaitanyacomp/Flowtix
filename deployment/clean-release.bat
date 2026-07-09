@echo off
REM FT-DEP-001 Batch 1 — remove previous release output before a new package is built.
setlocal EnableExtensions

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul 2>&1
if errorlevel 1 (
  echo [clean-release] ERROR: cannot resolve repo root.
  exit /b 1
)
set "ROOT=%CD%"
popd >nul

set "RELEASE_ROOT=%ROOT%\release"

echo [clean-release] Removing "%RELEASE_ROOT%" ...
if exist "%RELEASE_ROOT%" (
  rmdir /s /q "%RELEASE_ROOT%"
  if exist "%RELEASE_ROOT%" (
    echo [clean-release] ERROR: could not fully remove release folder. Close locks and retry.
    exit /b 1
  )
)

mkdir "%RELEASE_ROOT%" 2>nul
echo [clean-release] Done. Empty release root ready.
exit /b 0
