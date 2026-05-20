$ErrorActionPreference = "Stop"

$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverRoot = Join-Path $installDir "local-stt"
$pythonExe = Join-Path $serverRoot "venv\\Scripts\\python.exe"
$serverScript = Join-Path $serverRoot "local_stt_server.py"
$localModel = Join-Path $serverRoot "models\\faster-whisper-small-local"
$tinyModel = Join-Path $serverRoot "models\\models--Systran--faster-whisper-tiny"
$backendRoot = Join-Path $installDir "resources\\backend"
$backendNode = Join-Path $installDir "resources\\node-runtime\\node.exe"
$backendScript = Join-Path $backendRoot "server.mjs"
$backendLogDir = Join-Path $env:APPDATA "com.voiceslate.app\\cloud-backend"
$backendStdOut = Join-Path $backendLogDir "server.stdout.log"
$backendStdErr = Join-Path $backendLogDir "server.stderr.log"
$preferredExe = Join-Path $installDir "voiceslate.exe"
$fallbackExe = Join-Path $installDir "opentypeless-local.exe"
$appExe = if (Test-Path $preferredExe) { $preferredExe } else { $fallbackExe }
$healthUrl = "http://127.0.0.1:8178/health"
$backendHealthUrl = "http://127.0.0.1:8788/health"
$cloudProxyUrl = "http://127.0.0.1:7890"
$env:NO_PROXY = "127.0.0.1,localhost,::1"
$env:no_proxy = "127.0.0.1,localhost,::1"
$env:HTTP_PROXY = $cloudProxyUrl
$env:HTTPS_PROXY = $cloudProxyUrl
$env:ALL_PROXY = $cloudProxyUrl
$env:CLOUD_STT_HTTP_PROXY = $cloudProxyUrl
$env:STT_DEFAULT_PROVIDER = "cloud-opus"
$env:CLOUD_STT_UPSTREAM_PROVIDER = "volcengine-flash"
$env:STT_BENCHMARK_PROVIDERS = "local-whisper,volcengine-flash,openai-whisper,groq-whisper,glm-asr,siliconflow,cloud-opus"
$env:STT_ENABLE_REPLAY_BENCHMARK = "1"
$env:OPENTYPELESS_LOCAL_STT_COMMAND_MODEL = "tiny"
$env:OPENTYPELESS_LOCAL_STT_DEFAULT_LANGUAGE = "zh"
$env:VOICE_SLATE_BACKEND_HOST = "127.0.0.1"
$env:VOICE_SLATE_BACKEND_PORT = "8788"
$env:VOICE_SLATE_BACKEND_URL = "http://127.0.0.1:8788"
$env:VOICE_SLATE_BACKEND_DATA_DIR = $backendLogDir
$settingsCandidates = @(
  (Join-Path $env:APPDATA "com.voiceslate.app\settings.json"),
  (Join-Path $env:APPDATA "com.opentypeless.app\settings.json")
)

function Test-TcpPort([string]$hostName, [int]$portNumber) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $task = $client.ConnectAsync($hostName, $portNumber)
    if (-not $task.Wait(1000)) {
      $client.Dispose()
      return $false
    }
    $client.Dispose()
    return $true
  } catch {
    return $false
  }
}

function Start-CloudProxyIfNeeded {
  if (Test-TcpPort "127.0.0.1" 7890) {
    return
  }

  $clashCandidates = @(
    "D:\clash\Clash for Windows.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\Clash for Windows\Clash for Windows.exe"),
    (Join-Path $env:ProgramFiles "Clash for Windows\Clash for Windows.exe")
  )
  $clashExe = $clashCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($clashExe) {
    Start-Process -FilePath $clashExe -WorkingDirectory (Split-Path -Parent $clashExe) -WindowStyle Minimized
    for ($i = 0; $i -lt 45; $i++) {
      Start-Sleep -Seconds 1
      if (Test-TcpPort "127.0.0.1" 7890) {
        return
      }
    }
  }
}

function Set-LocalWhisperProvider {
  foreach ($settingsPath in $settingsCandidates) {
    if (-not (Test-Path $settingsPath)) {
      continue
    }

    try {
      $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
      if ($settings.app_config) {
        if ([string]::IsNullOrWhiteSpace([string]$settings.app_config.stt_provider)) {
          $settings.app_config.stt_provider = "cloud-opus"
        } elseif ([string]$settings.app_config.stt_provider -eq "local-whisper" -and -not (Test-Path $localModel)) {
          $settings.app_config.stt_provider = "cloud-opus"
        }
        $json = $settings | ConvertTo-Json -Depth 100
        [System.IO.File]::WriteAllText($settingsPath, $json, [System.Text.UTF8Encoding]::new($false))
      }
    } catch {
    }
  }
}

function Set-ManagedLlmProxy {
  $proxyBaseUrl = "http://127.0.0.1:8788/v1"

  foreach ($settingsPath in $settingsCandidates) {
    if (-not (Test-Path $settingsPath)) {
      continue
    }

    try {
      $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
      if (-not $settings.app_config) {
        continue
      }

      $snapshotPath = "$settingsPath.managed-llm.json"
      $appConfig = $settings.app_config
      $currentBase = [string]$appConfig.llm_base_url
      $currentKey = [string]$appConfig.llm_api_key
      $currentModel = [string]$appConfig.llm_model

      if (
        -not [string]::IsNullOrWhiteSpace($currentBase) -and
        -not $currentBase.StartsWith("http://127.0.0.1:8788", [System.StringComparison]::OrdinalIgnoreCase)
      ) {
        $snapshot = [ordered]@{
          api_key  = $currentKey
          base_url = $currentBase
          model    = $currentModel
        }
        $snapshotJson = $snapshot | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($snapshotPath, $snapshotJson, [System.Text.UTF8Encoding]::new($false))
      }

      if (Test-Path $snapshotPath) {
        $snapshot = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
        if (-not [string]::IsNullOrWhiteSpace([string]$snapshot.api_key)) {
          $env:CLOUD_LLM_API_KEY = [string]$snapshot.api_key
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$snapshot.base_url)) {
          $env:CLOUD_LLM_BASE_URL = [string]$snapshot.base_url
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$snapshot.model)) {
          $env:CLOUD_LLM_MODEL = [string]$snapshot.model
        }
      }

      if (
        -not [string]::IsNullOrWhiteSpace([string]$env:CLOUD_LLM_API_KEY) -and
        -not [string]::IsNullOrWhiteSpace([string]$env:CLOUD_LLM_BASE_URL) -and
        -not [string]::IsNullOrWhiteSpace([string]$env:CLOUD_LLM_MODEL)
      ) {
        $settings.app_config.llm_base_url = $proxyBaseUrl
        $json = $settings | ConvertTo-Json -Depth 100
        [System.IO.File]::WriteAllText($settingsPath, $json, [System.Text.UTF8Encoding]::new($false))
      }
    } catch {
    }
  }
}

Set-LocalWhisperProvider
Set-ManagedLlmProxy
Start-CloudProxyIfNeeded

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

function Test-BackendHealth {
  try {
    $response = Invoke-RestMethod -Uri $backendHealthUrl -Method Get -TimeoutSec 2
    return $response.ok -eq $true
  } catch {
    return $false
  }
}

function Get-SttProvider {
  foreach ($settingsPath in $settingsCandidates) {
    if (-not (Test-Path $settingsPath)) {
      continue
    }

    try {
      $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
      if ($settings.app_config.stt_provider) {
        return [string]$settings.app_config.stt_provider
      }
    } catch {
    }
  }

  return "cloud-opus"
}

$sttProvider = Get-SttProvider

if ($sttProvider -eq "local-whisper" -or $sttProvider -eq "cloud-opus") {
  if (-not (Test-Path $backendLogDir)) {
    New-Item -ItemType Directory -Path $backendLogDir -Force | Out-Null
  }

  if (-not (Test-Path $pythonExe)) {
    throw "Local STT Python runtime was not found: $pythonExe"
  }

  if (-not (Test-Path $serverScript)) {
    throw "Local STT server script was not found: $serverScript"
  }

  if (-not (Test-LocalSttHealth)) {
    if (Test-Path $localModel) {
      $env:OPENTYPELESS_LOCAL_STT_MODEL = $localModel
    } elseif (Test-Path $tinyModel) {
      $env:OPENTYPELESS_LOCAL_STT_MODEL = "tiny"
    }
    $env:OPENTYPELESS_LOCAL_STT_COMMAND_MODEL = "tiny"
    $env:OPENTYPELESS_LOCAL_STT_MODELS = Join-Path $serverRoot "models"
    $env:HF_HUB_DISABLE_XET = "1"
    $env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
    Start-Process -FilePath $pythonExe -ArgumentList @("`"$serverScript`"") -WorkingDirectory $serverRoot -WindowStyle Hidden

    $ready = $false
    for ($i = 0; $i -lt 120; $i++) {
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

  if ((Test-Path $backendNode) -and (Test-Path $backendScript) -and (-not (Test-BackendHealth))) {
    Start-Process -FilePath $backendNode -ArgumentList @("`"$backendScript`"") -WorkingDirectory $backendRoot -WindowStyle Hidden -RedirectStandardOutput $backendStdOut -RedirectStandardError $backendStdErr

    $backendReady = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 1
      if (Test-BackendHealth) {
        $backendReady = $true
        break
      }
    }

    if (-not $backendReady) {
      throw "Local backend service did not become ready in time."
    }
  }
}

Start-Process -FilePath $appExe -WorkingDirectory $installDir
