# Rebuilds the app and refreshes ..\bin\JJMP3.exe (the copy you can run or pin from the project folder).
# Usage: powershell -ExecutionPolicy Bypass -File app\build-local.ps1   (or: npm run local)
$ErrorActionPreference = "Stop"
$app = $PSScriptRoot
$bin = Join-Path (Split-Path $app -Parent) "bin"
$tmp = Join-Path $env:TEMP "jjmp3-local"   # electron-builder is slow and lock-prone on G:, so build on C:

Push-Location $app
try {
  node node_modules\electron-vite\bin\electron-vite.js build
  if ($LASTEXITCODE -ne 0) { throw "electron-vite build failed" }
  node node_modules\electron-builder\cli.js --win --dir --config.directories.output="$tmp"
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
} finally { Pop-Location }

Get-Process JJMP3 -ErrorAction SilentlyContinue | Stop-Process -Force  # any running copy locks files in bin
robocopy (Join-Path $tmp "win-unpacked") $bin /MIR /MT:16 /R:2 /W:1 /NFL /NDL /NJH /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copying to bin failed" }
Write-Host "Updated $bin\JJMP3.exe"