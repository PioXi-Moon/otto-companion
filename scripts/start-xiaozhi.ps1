$ErrorActionPreference = "Stop"

$OttoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ServerRoot = Join-Path $OttoRoot "vendor\xiaozhi-server\main\xiaozhi-server"
$Python = if ($env:XIAOZHI_PYTHON) {
  $env:XIAOZHI_PYTHON
} else {
  "C:\Users\13423\miniconda3\envs\xiaozhi\python.exe"
}
$EnvFile = Join-Path $OttoRoot ".env"

if (-not (Test-Path $Python)) {
  throw "找不到小智专用 Python 3.10：$Python"
}
if (-not (Test-Path $EnvFile)) {
  throw "找不到环境配置：$EnvFile"
}

Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) {
    return
  }
  $name, $value = $line.Split("=", 2)
  [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
}

if (-not $env:DEEPSEEK_API_KEY) {
  throw ".env 中缺少 DEEPSEEK_API_KEY"
}

function Test-OttoBridge {
  try {
    $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:7790/health" -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

# 小智和实体动作都依赖这个本地桥。先确保它在，避免要用户再记一个启动步骤。
if (-not (Test-OttoBridge)) {
  $bridge = Join-Path $OttoRoot "scripts\ble_otto_bridge.py"
  $bridgeOut = Join-Path $OttoRoot "data\bridge.log"
  $bridgeErr = Join-Path $OttoRoot "data\bridge.err.log"
  Write-Host "启动 Otto BLE 桥…"
  Start-Process -FilePath $Python `
    -ArgumentList @("-u", $bridge) `
    -WorkingDirectory $OttoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $bridgeOut `
    -RedirectStandardError $bridgeErr
  Start-Sleep -Seconds 2
  if (-not (Test-OttoBridge)) {
    Write-Warning "BLE 桥还没就绪；小智软件工具仍可用，但实体动作可能离线。日志：$bridgeErr"
  }
}

$env:PATH = @(
  (Join-Path $OttoRoot "vendor\xiaozhi-runtime\Library\bin"),
  (Join-Path $OttoRoot "vendor\xiaozhi-bin"),
  $env:PATH
) -join ";"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

Set-Location $ServerRoot
& $Python -u app.py
