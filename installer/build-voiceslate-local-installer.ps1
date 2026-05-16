param(
  [string]$SourceRoot = $(Join-Path $env:LOCALAPPDATA "VoiceSlate")
)

$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = "C:\vsbuild-voiceslate"
$runtimeRoot = Join-Path $buildRoot "runtime"
$payloadZip = Join-Path $buildRoot "VoiceSlate-runtime.zip"
$sedPath = Join-Path $buildRoot "VoiceSlate-Setup.sed"
$desktopOutput = Join-Path ([Environment]::GetFolderPath("Desktop")) "VoiceSlate-Local-STT-Setup.exe"

function Reset-Dir([string]$path) {
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
  New-Item -ItemType Directory -Path $path -Force | Out-Null
}

function Copy-Tree([string]$from, [string]$to) {
  New-Item -ItemType Directory -Path $to -Force | Out-Null
  $null = robocopy $from $to /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD "__pycache__" ".cache" 2>$null
  if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed from $from to $to with exit code $LASTEXITCODE"
  }
}

if (-not (Test-Path $sourceRoot)) {
  throw "Source runtime was not found: $sourceRoot"
}

Write-Host "Preparing staging folders..."
Reset-Dir $buildRoot
Reset-Dir $runtimeRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "install-voiceslate-runtime.ps1") -Destination $buildRoot
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "install-voiceslate-runtime.cmd") -Destination $buildRoot

Write-Host "Copying app and launchers..."
Copy-Item -LiteralPath (Join-Path $sourceRoot "voiceslate.exe") -Destination $runtimeRoot
Copy-Item -LiteralPath (Join-Path $sourceRoot "launch-voiceslate-local.cmd") -Destination $runtimeRoot
Copy-Item -LiteralPath (Join-Path $sourceRoot "launch-voiceslate-local.vbs") -Destination $runtimeRoot
Copy-Item -LiteralPath (Join-Path $sourceRoot "launch-voiceslate-local.ps1") -Destination $runtimeRoot

Write-Host "Copying local STT runtime..."
New-Item -ItemType Directory -Path (Join-Path $runtimeRoot "local-stt") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot "local-stt\local_stt_server.py") -Destination (Join-Path $runtimeRoot "local-stt")
Copy-Tree (Join-Path $sourceRoot "local-stt\venv") (Join-Path $runtimeRoot "local-stt\venv")
$smallModel = Join-Path $sourceRoot "local-stt\models\faster-whisper-small-local"
if ($env:VOICESLATE_INSTALLER_INCLUDE_SMALL_MODEL -eq "1" -and (Test-Path $smallModel)) {
  Copy-Tree $smallModel (Join-Path $runtimeRoot "local-stt\models\faster-whisper-small-local")
}
$tinyModel = Join-Path $sourceRoot "local-stt\models\models--Systran--faster-whisper-tiny"
if (Test-Path $tinyModel) {
  Copy-Tree $tinyModel (Join-Path $runtimeRoot "local-stt\models\models--Systran--faster-whisper-tiny")
}

Write-Host "Copying local backend runtime..."
Copy-Tree (Join-Path $sourceRoot "resources\backend") (Join-Path $runtimeRoot "resources\backend")
Copy-Tree (Join-Path $sourceRoot "resources\node-runtime") (Join-Path $runtimeRoot "resources\node-runtime")

Write-Host "Copying default desktop settings..."
$defaultsRoot = Join-Path $runtimeRoot "defaults"
New-Item -ItemType Directory -Path $defaultsRoot -Force | Out-Null
$settingsSource = Join-Path $env:APPDATA "com.voiceslate.app\settings.json"
$managedLlmSource = Join-Path $env:APPDATA "com.voiceslate.app\settings.json.managed-llm.json"
if (Test-Path $settingsSource) {
  Copy-Item -LiteralPath $settingsSource -Destination (Join-Path $defaultsRoot "settings.json") -Force
}
if (Test-Path $managedLlmSource) {
  Copy-Item -LiteralPath $managedLlmSource -Destination (Join-Path $defaultsRoot "settings.json.managed-llm.json") -Force
}

Write-Host "Creating payload zip..."
if (Test-Path $payloadZip) {
  Remove-Item -LiteralPath $payloadZip -Force
}
Compress-Archive -Path (Join-Path $runtimeRoot "*") -DestinationPath $payloadZip -CompressionLevel Optimal

Write-Host "Building installer EXE on Desktop..."
if (Test-Path $desktopOutput) {
  Remove-Item -LiteralPath $desktopOutput -Force
}
$sfxOut = Join-Path $buildRoot "sfx"
Reset-Dir $sfxOut
$cscCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe"),
  (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe")
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) {
  throw "C# compiler was not found."
}
$setupSource = Join-Path $PSScriptRoot "VoiceSlateSetup\Program.cs"
$stub = Join-Path $sfxOut "VoiceSlateSetup.exe"
& $csc /nologo /target:exe /platform:x64 /out:$stub /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:Microsoft.CSharp.dll $setupSource
if (-not (Test-Path $stub)) {
  throw "Setup stub was not produced: $stub"
}
Copy-Item -LiteralPath $stub -Destination $desktopOutput -Force
$payloadBytes = [System.IO.File]::ReadAllBytes($payloadZip)
$magicBytes = [System.Text.Encoding]::ASCII.GetBytes("VOICE_SLATE_PAYLOAD_V1")
$lengthBytes = [System.BitConverter]::GetBytes([Int64]$payloadBytes.Length)
$stream = [System.IO.File]::Open($desktopOutput, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write)
try {
  $stream.Write($payloadBytes, 0, $payloadBytes.Length)
  $stream.Write($lengthBytes, 0, $lengthBytes.Length)
  $stream.Write($magicBytes, 0, $magicBytes.Length)
} finally {
  $stream.Dispose()
}
if (-not (Test-Path $desktopOutput)) {
  throw "Installer was not produced: $desktopOutput"
}

Write-Host "Installer ready: $desktopOutput"
