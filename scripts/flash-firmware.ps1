$ErrorActionPreference = "Stop"

$OttoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ToolsDir = Join-Path $OttoRoot "data\arduino-tools"
$CliDir = Join-Path $ToolsDir "cli"
$Cli = Join-Path $CliDir "arduino-cli.exe"
$Sketch = Join-Path $OttoRoot "firmware\otto_controller_single"

New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
if (-not (Test-Path $Cli)) {
  $zip = Join-Path $ToolsDir "arduino-cli.zip"
  Write-Host "Downloading Arduino CLI..."
  Invoke-WebRequest `
    -Uri "https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_Windows_64bit.zip" `
    -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $CliDir -Force
}

$env:ARDUINO_DIRECTORIES_DATA = Join-Path $OttoRoot "data\arduino15"
$env:ARDUINO_DIRECTORIES_DOWNLOADS = Join-Path $OttoRoot "data\arduino-staging"

$CoreDir = Join-Path $env:ARDUINO_DIRECTORIES_DATA "packages\arduino\hardware\avr"
if (-not (Test-Path $CoreDir)) {
  Write-Host "Installing Arduino AVR core..."
  & $Cli core update-index
  if ($LASTEXITCODE -ne 0) { throw "Arduino core index update failed." }
  & $Cli core install arduino:avr
  if ($LASTEXITCODE -ne 0) { throw "Arduino AVR core install failed." }
}

$ServoDir = Join-Path $env:ARDUINO_DIRECTORIES_DATA "libraries\Servo"
if (-not (Test-Path $ServoDir)) {
  Write-Host "Installing Servo library..."
  & $Cli lib install Servo
  if ($LASTEXITCODE -ne 0) { throw "Servo library install failed." }
}

Write-Host "Compiling Otto firmware..."
& $Cli compile --fqbn arduino:avr:nano $Sketch
if ($LASTEXITCODE -ne 0) { throw "Firmware compile failed." }

Write-Host ""
Write-Host "IMPORTANT: unplug the Bluetooth serial module's TX/RX wires before flashing."
Write-Host "The HM-10 module shares D0/D1 with the Nano bootloader and will corrupt the upload."

if ($env:OTTO_FLASH_PORT) {
  $usbPorts = @([pscustomobject]@{ address = $env:OTTO_FLASH_PORT })
} else {
  $raw = & $Cli board list --format json
  if ($LASTEXITCODE -ne 0) { throw "Could not enumerate serial ports." }
  $usbPorts = @(($raw -join "`n" | ConvertFrom-Json).detected_ports |
    ForEach-Object { $_.port } |
    Where-Object { $_.label -match "USB" })
}

if ($usbPorts.Count -eq 0) {
  throw "No USB serial port found. Connect the USB cable to the Arduino Nano, not only to Otto's power input."
}
if ($usbPorts.Count -gt 1) {
  $names = $usbPorts.address -join ", "
  throw "More than one USB serial port was found: $names. Set OTTO_FLASH_PORT=COMx and run again."
}

$port = $usbPorts[0].address
Write-Host "Flashing through $port..."

foreach ($cpu in @("atmega328", "atmega328old")) {
  $fqbn = "arduino:avr:nano:cpu=$cpu"
  Write-Host "Trying $cpu bootloader..."
  & $Cli upload -p $port --fqbn $fqbn $Sketch
  if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Firmware uploaded successfully through $port ($cpu)."
    exit 0
  }
}

Write-Host ""
Write-Host "Upload failed for both Nano bootloaders."
Write-Host "Check that the cable is plugged into the Nano's own USB port."
Write-Host "Disconnect the Bluetooth serial module's TX/RX wires from D0/D1 and retry."
exit 1
