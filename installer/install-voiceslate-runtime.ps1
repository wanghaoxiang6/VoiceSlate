$ErrorActionPreference = "Stop"

$installDir = Join-Path $env:LOCALAPPDATA "VoiceSlate"
$payloadZip = Join-Path $PSScriptRoot "VoiceSlate-runtime.zip"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "VoiceSlate.lnk"
$startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$startMenuShortcut = Join-Path $startMenuDir "VoiceSlate.lnk"

function Stop-InstalledProcesses {
  $targets = @(
    @{ Name = "voiceslate"; Path = (Join-Path $installDir "voiceslate.exe") },
    @{ Name = "node"; Path = (Join-Path $installDir "resources\node-runtime\node.exe") },
    @{ Name = "python"; Path = (Join-Path $installDir "local-stt\venv\Scripts\python.exe") }
  )

  foreach ($target in $targets) {
    Get-Process -Name $target.Name -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq $target.Path } |
      ForEach-Object { Stop-Process -Id $_.Id -Force }
  }
}

function New-Shortcut($shortcutPath, $targetPath, $arguments, $workingDir, $iconLocation) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $targetPath
  if ($arguments) {
    $shortcut.Arguments = $arguments
  }
  $shortcut.WorkingDirectory = $workingDir
  $shortcut.IconLocation = $iconLocation
  $shortcut.Save()
}

if (-not (Test-Path $payloadZip)) {
  throw "Installer payload was not found: $payloadZip"
}

Write-Host "[1/4] Stopping previous VoiceSlate processes..."
Stop-InstalledProcesses

if (Test-Path $installDir) {
  Write-Host "[2/4] Removing previous install at $installDir"
  Remove-Item -LiteralPath $installDir -Recurse -Force
}

Write-Host "[3/4] Installing runtime to $installDir"
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Expand-Archive -LiteralPath $payloadZip -DestinationPath $installDir -Force

$launcherVbs = Join-Path $installDir "launch-voiceslate-local.vbs"
$launcherCmd = Join-Path $installDir "launch-voiceslate-local.cmd"
$appExe = Join-Path $installDir "voiceslate.exe"

if (-not (Test-Path $launcherVbs) -or -not (Test-Path $launcherCmd) -or -not (Test-Path $appExe)) {
  throw "Install verification failed. Core launcher files are missing."
}

Write-Host "[4/4] Creating shortcuts"
New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
New-Shortcut `
  -shortcutPath $desktopShortcut `
  -targetPath "$env:WINDIR\System32\wscript.exe" `
  -arguments ('"' + $launcherVbs + '"') `
  -workingDir $installDir `
  -iconLocation ($appExe + ",0")
New-Shortcut `
  -shortcutPath $startMenuShortcut `
  -targetPath "$env:WINDIR\System32\wscript.exe" `
  -arguments ('"' + $launcherVbs + '"') `
  -workingDir $installDir `
  -iconLocation ($appExe + ",0")

Write-Host "Install complete. Use the VoiceSlate desktop shortcut to start the app."
