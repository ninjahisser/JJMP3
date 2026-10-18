# Builds both JJMP3 firmwares and flashes them: music mode (app0) + Wi-Fi mode (app1).
# Usage: powershell -ExecutionPolicy Bypass -File firmware\flash.ps1 [-Port COM3]
# Close the JJMP3 app first, it holds the USB serial port.
param([string]$Port = "COM3", [switch]$NoBuild)
$ErrorActionPreference = "Stop"

$cli = "C:\Program Files\Arduino CLI\arduino-cli.exe"
$fqbn = "esp32:esp32:esp32:PartitionScheme=min_spiffs"
$sketch = Join-Path $PSScriptRoot "jjmp3"
$out = Join-Path $PSScriptRoot "build"
$data = (& $cli config get directories.data | Out-String).Trim()

if (-not $NoBuild) {
  foreach ($flavour in @(@{ Name = "music"; Wifi = 0 }, @{ Name = "wifi"; Wifi = 1 })) {
    Write-Host "Building $($flavour.Name) firmware..."
    & $cli compile --fqbn $fqbn --build-property "compiler.cpp.extra_flags=-DJJ_WIFI=$($flavour.Wifi)" `
      --build-path (Join-Path $out ".cache-$($flavour.Name)") --output-dir (Join-Path $out $flavour.Name) $sketch
    if ($LASTEXITCODE -ne 0) { throw "Build failed: $($flavour.Name)" }
  }
}

$esptool = (Get-ChildItem "$data\packages\esp32\tools\esptool_py\*\esptool.exe" | Select-Object -First 1).FullName
$bootApp0 = (Get-ChildItem "$data\packages\esp32\hardware\esp32\*\tools\partitions\boot_app0.bin" | Select-Object -First 1).FullName
Write-Host "Flashing $Port..."
& $esptool --chip esp32 --port $Port --baud 921600 write-flash `
  0x1000 "$out\music\jjmp3.ino.bootloader.bin" `
  0x8000 "$out\music\jjmp3.ino.partitions.bin" `
  0xe000 $bootApp0 `
  0x10000 "$out\music\jjmp3.ino.bin" `
  0x1F0000 "$out\wifi\jjmp3.ino.bin"
if ($LASTEXITCODE -ne 0) { throw "Flashing failed" }
Write-Host "Done. The player starts in music mode; triple-click the button to switch."