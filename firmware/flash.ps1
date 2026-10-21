# Builds both JJMP3 firmwares and flashes them: music mode (app0) + Wi-Fi mode (app1).
# Usage: powershell -ExecutionPolicy Bypass -File firmware\flash.ps1 [-Port COM3]
# Close the JJMP3 app first, it holds the USB serial port.
param([string]$Port = "COM3", [switch]$NoBuild, [string]$DataDir = "")
$ErrorActionPreference = "Stop"

$cli = "C:\Program Files\Arduino CLI\arduino-cli.exe"
$fqbn = "esp32:esp32:esp32:PartitionScheme=min_spiffs"
$sketch = Join-Path $PSScriptRoot "jjmp3"
$out = Join-Path $PSScriptRoot "build"

# Where arduino-cli keeps the ESP32 core and tools. The CLI often reports the
# wrong default, so look for the core in the usual places instead.
function Find-DataDir {
  if ($DataDir) { return $DataDir }
  foreach ($d in @((& $cli config get directories.data | Out-String).Trim(),
                   "$env:LOCALAPPDATA\Arduino15",
                   (Join-Path $env:USERPROFILE "AppData\Local\Arduino15"))) {
    if ($d -and (Test-Path (Join-Path $d "packages\esp32\hardware\esp32"))) { return $d }
  }
  foreach ($root in @("G:\Arduino15", "D:\Arduino15", "C:\Arduino15")) {
    if (Test-Path (Join-Path $root "packages\esp32\hardware\esp32")) { return $root }
  }
  return ((& $cli config get directories.data | Out-String).Trim())
}
$data = Find-DataDir

function Fail($msg) {
  Write-Host ""
  Write-Host "*** $msg ***" -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path (Join-Path $data "packages\esp32\hardware\esp32"))) {
  Fail "ESP32 core not found under '$data'. Install it with:`n    arduino-cli core install esp32:esp32 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json`nor pass -DataDir <path>."
}

# The CLI ignores its own config for some installs, so point it at the core
# explicitly for the compile step too.
$env:ARDUINO_DIRECTORIES_DATA = $data

if (-not $NoBuild) {
  foreach ($flavour in @(@{ Name = "music"; Wifi = 0 }, @{ Name = "wifi"; Wifi = 1 })) {
    Write-Host "Building $($flavour.Name) firmware..."
    & $cli compile --fqbn $fqbn --build-property "compiler.cpp.extra_flags=-DJJ_WIFI=$($flavour.Wifi)" `
      --build-path (Join-Path $out ".cache-$($flavour.Name)") --output-dir (Join-Path $out $flavour.Name) $sketch
    if ($LASTEXITCODE -ne 0) { Fail "Build failed: $($flavour.Name)" }
  }
}

$esptool = (Get-ChildItem "$data\packages\esp32\tools\esptool_py\*\esptool.exe" | Select-Object -First 1).FullName
$bootApp0 = (Get-ChildItem "$data\packages\esp32\hardware\esp32\*\tools\partitions\boot_app0.bin" | Select-Object -First 1).FullName
if (-not $esptool) { Fail "esptool not found under '$data'." }
if (-not $bootApp0) { Fail "boot_app0.bin not found under '$data'." }
Write-Host "Flashing $Port..."
& $esptool --chip esp32 --port $Port --baud 921600 write-flash `
  0x1000 "$out\music\jjmp3.ino.bootloader.bin" `
  0x8000 "$out\music\jjmp3.ino.partitions.bin" `
  0xe000 $bootApp0 `
  0x10000 "$out\music\jjmp3.ino.bin" `
  0x1F0000 "$out\wifi\jjmp3.ino.bin"
if ($LASTEXITCODE -ne 0) { Fail "Flashing failed. Is the JJMP3 app or a serial monitor holding $Port?" }
Write-Host "Done. The player starts in music mode; triple-click the button to switch."