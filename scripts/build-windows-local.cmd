@echo off
setlocal

set "BUILD_MODE=%~1"
if not defined BUILD_MODE set "BUILD_MODE=tauri"

set "VSWHERE=C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo [error] vswhere.exe not found at "%VSWHERE%"
  exit /b 1
)

set "VS_INSTALL="
for /f "usebackq delims=" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do (
  set "VS_INSTALL=%%I"
)

if not defined VS_INSTALL (
  echo [error] Unable to locate a Visual Studio C++ build tools installation.
  exit /b 1
)

set "VCVARS=%VS_INSTALL%\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
  echo [error] vcvars64.bat not found at "%VCVARS%"
  exit /b 1
)

if not exist "C:\codex-tmp" mkdir "C:\codex-tmp"
if not exist "C:\codex-target\voiceslate-msvc" mkdir "C:\codex-target\voiceslate-msvc"
if not exist "C:\codex-rust-bin" mkdir "C:\codex-rust-bin"

copy /Y "%USERPROFILE%\.cargo\bin\rustup.exe" "C:\codex-rust-bin\cargo.exe" >nul
copy /Y "%USERPROFILE%\.cargo\bin\rustup.exe" "C:\codex-rust-bin\rustc.exe" >nul
copy /Y "%USERPROFILE%\.cargo\bin\rustup.exe" "C:\codex-rust-bin\rustdoc.exe" >nul

call "%VCVARS%"
if errorlevel 1 exit /b %errorlevel%

set "PATH=C:\codex-rust-bin;%USERPROFILE%\.cargo\bin;%PATH%"
set "TEMP=C:\codex-tmp"
set "TMP=C:\codex-tmp"
set "CARGO_TARGET_DIR=C:\codex-target\voiceslate-msvc"

echo [info] Using Visual Studio at "%VS_INSTALL%"
echo [info] Target dir: "%CARGO_TARGET_DIR%"
echo [info] Rust proxy dir: "C:\codex-rust-bin"
where cargo
if errorlevel 1 (
  echo [error] cargo.exe was not found on PATH.
  exit /b 1
)
set "CARGO_BIN=%USERPROFILE%\.cargo\bin\cargo.exe"
cargo --version
if errorlevel 1 exit /b %errorlevel%

if /I "%BUILD_MODE%"=="cargo-only" (
  cargo build --release --features custom-protocol
  exit /b %errorlevel%
)

npx tauri build --runner cargo
exit /b %errorlevel%
