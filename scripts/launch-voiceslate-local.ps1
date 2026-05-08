$ErrorActionPreference = "Stop"

$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverRoot = Join-Path $installDir "local-stt"
$pythonExe = Join-Path $serverRoot "venv\\Scripts\\python.exe"
$serverScript = Join-Path $serverRoot "local_stt_server.py"
$appExe = Join-Path $installDir "voiceslate.exe"
$healthUrl = "http://127.0.0.1:8178/health"
$settingsPath = Join-Path $env:APPDATA "com.voiceslate.app\settings.json"

if (-not (Test-Path $pythonExe)) {
  throw "Local STT Python runtime was not found: $pythonExe"
}

if (-not (Test-Path $serverScript)) {
  throw "Local STT server script was not found: $serverScript"
}

if (-not (Test-Path $appExe)) {
  throw "VoiceSlate app was not found: $appExe"
}

function Test-LocalSttHealth {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 2
    return $response.status -eq "ok"
  } catch {
    return $false
  }
}

function Get-SttProvider {
  if (-not (Test-Path $settingsPath)) {
    return "local-whisper"
  }

  try {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    if ($settings.app_config.stt_provider) {
      return [string]$settings.app_config.stt_provider
    }
  } catch {
  }

  return "local-whisper"
}

$sttProvider = Get-SttProvider

if ($sttProvider -eq "local-whisper") {
  if (-not (Test-LocalSttHealth)) {
    Start-Process -FilePath $pythonExe -ArgumentList @("`"$serverScript`"") -WorkingDirectory $serverRoot -WindowStyle Hidden

    $ready = $false
    for ($i = 0; $i -lt 600; $i++) {
      Start-Sleep -Seconds 1
      if (Test-LocalSttHealth) {
        $ready = $true
        break
      }
    }

    if (-not $ready) {
      throw "Local STT service did not become ready in time."
    }
  }
}

Start-Process -FilePath $appExe -WorkingDirectory $installDir
