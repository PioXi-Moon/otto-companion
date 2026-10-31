param(
  [string]$OutputZip
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$DistRoot = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot "dist"))
$StageRoot = [System.IO.Path]::GetFullPath((Join-Path $DistRoot "Otto"))
$ElectronDist = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot "node_modules\electron\dist"))
$ArchiveDate = Get-Date -Format "yyyyMMdd"

if (-not $OutputZip) {
  $OutputZip = Join-Path $DistRoot "Otto-Windows-x64-$ArchiveDate.zip"
}
$OutputZip = [System.IO.Path]::GetFullPath($OutputZip)

function Assert-ChildPath {
  param(
    [string]$Child,
    [string]$Parent,
    [string]$Label
  )

  $prefix = $Parent.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
  if (-not $Child.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label 不在允许的目录内：$Child"
  }
}

Assert-ChildPath -Child $StageRoot -Parent $DistRoot -Label "临时打包目录"
Assert-ChildPath -Child $OutputZip -Parent $DistRoot -Label "ZIP 输出路径"

if (-not (Test-Path -LiteralPath (Join-Path $ElectronDist "electron.exe"))) {
  throw "找不到 Electron 运行时，请先在项目目录执行 pnpm install。"
}

New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null

# 只清理本脚本明确管理的两个构建目标，不碰项目源码。
if (Test-Path -LiteralPath $StageRoot) {
  Remove-Item -LiteralPath $StageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $OutputZip) {
  Remove-Item -LiteralPath $OutputZip -Force
}
Get-ChildItem -LiteralPath $DistRoot -File |
  Where-Object { $_.Name -match '^(key-setup-preview|otto-runtime-|storage-test)' } |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null
Copy-Item -Path (Join-Path $ElectronDist "*") -Destination $StageRoot -Recurse -Force
Move-Item -LiteralPath (Join-Path $StageRoot "electron.exe") -Destination (Join-Path $StageRoot "Otto.exe")

$AppRoot = Join-Path $StageRoot "resources\app"
New-Item -ItemType Directory -Path $AppRoot -Force | Out-Null

foreach ($name in @("electron", "server", "ui")) {
  Copy-Item -LiteralPath (Join-Path $ProjectRoot $name) -Destination $AppRoot -Recurse -Force
}
foreach ($name in @("package.json", "README.md", "THIRD_PARTY_NOTICES.md", "otto.ico")) {
  Copy-Item -LiteralPath (Join-Path $ProjectRoot $name) -Destination $AppRoot -Force
}

# 额外扫一遍准备放出的文本文件，确保当前 .env 里的真实 Key 没有混进去。
# 这里不输出 Key 本身，只报告是否存在。
$envFile = Join-Path $ProjectRoot ".env"
$secret = $null
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*DEEPSEEK_API_KEY\s*=\s*(.*)$') {
      $candidate = $Matches[1].Trim().Trim('"').Trim("'")
      if ($candidate.Length -ge 20 -and $candidate -notmatch 'x{8,}') {
        $secret = $candidate
      }
    }
  }
}

$forbiddenNames = Get-ChildItem -LiteralPath $AppRoot -Recurse -Force -File |
  Where-Object { $_.Name -match '^\.env($|\.)' -or $_.FullName -match '[\\/]data[\\/]' }
if ($forbiddenNames) {
  $names = ($forbiddenNames | ForEach-Object { $_.FullName.Substring($AppRoot.Length + 1) }) -join ", "
  throw "发布目录里出现了禁止携带的本地文件：$names"
}

if ($secret) {
  $textExtensions = @(".js", ".cjs", ".mjs", ".json", ".html", ".css", ".md", ".txt", ".bat", ".ps1")
  foreach ($file in Get-ChildItem -LiteralPath $AppRoot -Recurse -Force -File) {
    if ($textExtensions -notcontains $file.Extension.ToLowerInvariant()) {
      continue
    }
    if ([System.IO.File]::ReadAllText($file.FullName).Contains($secret, [System.StringComparison]::Ordinal)) {
      throw "检测到当前 API Key 被写进了发布文件：$($file.FullName.Substring($AppRoot.Length + 1))"
    }
  }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $StageRoot,
  $OutputZip,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $true
)

# 再检查压缩包条目，防止在压缩阶段混入本地配置。
$archive = [System.IO.Compression.ZipFile]::OpenRead($OutputZip)
try {
  $badEntries = $archive.Entries |
    Where-Object { $_.FullName -match '(^|/)\.env($|\.)' -or $_.FullName -match '(^|/)data/' }
  if ($badEntries) {
    throw "压缩包里发现了本地配置或数据目录：$($badEntries.FullName -join ', ')"
  }
  $fileCount = $archive.Entries.Count
}
finally {
  $archive.Dispose()
}

$sizeMb = [math]::Round((Get-Item -LiteralPath $OutputZip).Length / 1MB, 1)
Write-Host ""
Write-Host "便携版已生成：$OutputZip"
Write-Host "文件数：$fileCount，大小：$sizeMb MB"
Write-Host "已排除 .env 和 data/，并检查当前 API Key 未进入发布文件。"
