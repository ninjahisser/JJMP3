# Builds both firmwares and packs everything a user needs to flash a player, so nobody else has to compile:
#   app\firmware\          bundled into the app (it flashes over USB or Wi-Fi from there)
#   firmware\build\release\Z0E-firmware-<version>.bin   one image for web flashers, written at 0x0
# Usage: powershell -ExecutionPolicy Bypass -File firmware\release.ps1 [-NoBuild]
param([switch]$NoBuild)
$ErrorActionPreference = "Stop"

$cli = "C:\Program Files\Arduino CLI\arduino-cli.exe"
$fqbn = "esp32:esp32:esp32:PartitionScheme=min_spiffs"
$sketch = Join-Path $PSScriptRoot "jjmp3"
$out = Join-Path $PSScriptRoot "build"
$appFw = Join-Path (Split-Path $PSScriptRoot -Parent) "app\firmware"

$data = $null
foreach ($d in @("$env:LOCALAPPDATA\Arduino15", "G:\Arduino15", "D:\Arduino15", "C:\Arduino15")) {
  if (Test-Path (Join-Path $d "packages\esp32\hardware\esp32")) { $data = $d; break }
}
if (-not $data) { throw "ESP32 core not found (looked in %LOCALAPPDATA%\Arduino15, G:, D:, C:)." }
$env:ARDUINO_DIRECTORIES_DATA = $data

if (-not $NoBuild) {
  foreach ($f in @(@{ Name = "music"; Wifi = 0 }, @{ Name = "wifi"; Wifi = 1 })) {
    Write-Host "Building $($f.Name) firmware..."
    & $cli compile --fqbn $fqbn --build-property "compiler.cpp.extra_flags=-DJJ_WIFI=$($f.Wifi)" `
      --build-path (Join-Path $out ".cache-$($f.Name)") --output-dir (Join-Path $out $f.Name) $sketch
    if ($LASTEXITCODE -ne 0) { throw "Build failed: $($f.Name)" }
  }
}

$esptoolDir = (Get-ChildItem "$data\packages\esp32\tools\esptool_py\*" -Directory | Sort-Object Name | Select-Object -Last 1).FullName
$bootApp0 = (Get-ChildItem "$data\packages\esp32\hardware\esp32\*\tools\partitions\boot_app0.bin" | Select-Object -First 1).FullName
$version = ([regex]'FW_VERSION\s+"([^"]+)"').Match((Get-Content (Join-Path $sketch "config.h") -Raw)).Groups[1].Value

# the same five pieces flash.ps1 writes, with fixed names
New-Item -ItemType Directory -Force $appFw | Out-Null
Copy-Item "$out\music\jjmp3.ino.bootloader.bin" "$appFw\bootloader.bin"
Copy-Item "$out\music\jjmp3.ino.partitions.bin" "$appFw\partitions.bin"
Copy-Item $bootApp0 "$appFw\boot_app0.bin"
Copy-Item "$out\music\jjmp3.ino.bin" "$appFw\music.bin"
Copy-Item "$out\wifi\jjmp3.ino.bin" "$appFw\wifi.bin"
Copy-Item "$esptoolDir\esptool.exe" "$appFw\esptool.exe"
Copy-Item "$esptoolDir\LICENSE" "$appFw\esptool-LICENSE.txt"
Set-Content "$appFw\version.txt" $version -NoNewline -Encoding ascii

# one file for browser flashers (ESP Web Tools, esptool-js): write it at 0x0
$rel = Join-Path $out "release"
New-Item -ItemType Directory -Force $rel | Out-Null
$merged = Join-Path $rel "Z0E-firmware-$version.bin"
& "$appFw\esptool.exe" --chip esp32 merge-bin -o $merged `
  0x1000 "$appFw\bootloader.bin" 0x8000 "$appFw\partitions.bin" 0xe000 "$appFw\boot_app0.bin" `
  0x10000 "$appFw\music.bin" 0x1F0000 "$appFw\wifi.bin" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "merge-bin failed" }

Write-Host "Firmware $version packed into $appFw"
Write-Host "Single image: $merged"
