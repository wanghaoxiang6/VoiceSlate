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
$launcherLog = Join-Path $backendLogDir "launcher.log"
$env:NO_PROXY = "127.0.0.1,localhost,::1"
$env:no_proxy = "127.0.0.1,localhost,::1"
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

function Write-LauncherLog([string]$message) {
  try {
    if (-not (Test-Path $backendLogDir)) {
      New-Item -ItemType Directory -Path $backendLogDir -Force | Out-Null
    }
    $line = "$(Get-Date -Format o) $message"
    Add-Content -LiteralPath $launcherLog -Value $line -Encoding UTF8
  } catch {
  }
}

function Set-CloudProxyEnvIfAvailable {
  if (Test-TcpPort "127.0.0.1" 7890) {
    $env:HTTP_PROXY = $cloudProxyUrl
    $env:HTTPS_PROXY = $cloudProxyUrl
    $env:ALL_PROXY = $cloudProxyUrl
    $env:CLOUD_STT_HTTP_PROXY = $cloudProxyUrl
    Write-LauncherLog "Using existing local proxy at $cloudProxyUrl."
  } else {
    Remove-Item Env:\HTTP_PROXY -ErrorAction SilentlyContinue
    Remove-Item Env:\HTTPS_PROXY -ErrorAction SilentlyContinue
    Remove-Item Env:\ALL_PROXY -ErrorAction SilentlyContinue
    Remove-Item Env:\CLOUD_STT_HTTP_PROXY -ErrorAction SilentlyContinue
    Write-LauncherLog "Local proxy 127.0.0.1:7890 is not running; continuing without launching proxy."
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
Set-CloudProxyEnvIfAvailable

if (-not (Test-Path $appExe)) {
  throw "VoiceSlate app was not found: $appExe"
}

function Test-LocalSttHealth {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 1
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

function Get-BackendCloudUpstream {
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:8788/api/stt/providers?provider=cloud-opus" -Method Get -TimeoutSec 2
    return [string]$response.upstream_provider
  } catch {
    return ""
  }
}

function Stop-BackendIfWrongUpstream {
  $upstream = Get-BackendCloudUpstream
  if ([string]::IsNullOrWhiteSpace($upstream) -or $upstream -eq "volcengine-flash") {
    return
  }

  Write-LauncherLog "Restarting backend 8788 because cloud-opus upstream is '$upstream', expected 'volcengine-flash'."
  try {
    $connections = Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
  } catch {
    Write-LauncherLog "Failed to stop backend with wrong upstream: $($_.Exception.Message)"
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

  Stop-BackendIfWrongUpstream

  if ((Test-Path $backendNode) -and (Test-Path $backendScript) -and (-not (Test-BackendHealth))) {
    Write-LauncherLog "Starting backend 8788."
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

  $shouldStartLocalStt = $sttProvider -eq "local-whisper" -or $env:STT_ENABLE_LOCAL_COMMAND_PRECHECK -eq "1"

  if ((-not $shouldStartLocalStt) -and (-not (Test-LocalSttHealth))) {
    Write-LauncherLog "Skipping optional local command STT 8178; cloud-opus does not require it."
  } elseif (-not (Test-LocalSttHealth)) {
    if (-not (Test-Path $pythonExe)) {
      Write-LauncherLog "Local STT Python runtime was not found: $pythonExe"
    } elseif (-not (Test-Path $serverScript)) {
      Write-LauncherLog "Local STT server script was not found: $serverScript"
    } else {
      if (Test-Path $localModel) {
        $env:OPENTYPELESS_LOCAL_STT_MODEL = $localModel
      } elseif (Test-Path $tinyModel) {
        $env:OPENTYPELESS_LOCAL_STT_MODEL = "tiny"
      }
      $env:OPENTYPELESS_LOCAL_STT_COMMAND_MODEL = "tiny"
      $env:OPENTYPELESS_LOCAL_STT_MODELS = Join-Path $serverRoot "models"
      $env:OPENTYPELESS_LOCAL_STT_TIMING_LOG = Join-Path $env:APPDATA "com.voiceslate.app\logs\local-stt-timing.jsonl"
      $env:HF_HUB_DISABLE_XET = "1"
      $env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"
      $env:PYTHONFAULTHANDLER = "1"
      Write-LauncherLog "Starting optional local command STT 8178."
      Start-Process -FilePath $pythonExe -ArgumentList @("-X", "faulthandler", "-u", "`"$serverScript`"") -WorkingDirectory $serverRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $backendLogDir "local-stt.stdout.log") -RedirectStandardError (Join-Path $backendLogDir "local-stt.stderr.log")

      $ready = $false
      for ($i = 0; $i -lt 4; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-LocalSttHealth) {
          $ready = $true
          break
        }
      }

      if (-not $ready) {
        Write-LauncherLog "Optional local command STT 8178 did not become ready; continuing because cloud-opus uses backend 8788."
      }
    }
  }
}

Start-Process -FilePath $appExe -WorkingDirectory $installDir
