# Rebuilds app\JJMP3.exe from launcher\launcher.py
$ErrorActionPreference = "Stop"
$app = Split-Path $PSScriptRoot -Parent
$py = Join-Path $app ".venv\Scripts\python.exe"
& $py -m pip install -q pyinstaller
& $py -m PyInstaller --noconfirm --clean --onefile --windowed --name JJMP3 `
  --icon (Join-Path $PSScriptRoot "jjmp3.ico") `
  --distpath $app --workpath (Join-Path $PSScriptRoot "build") --specpath (Join-Path $PSScriptRoot "build") `
  (Join-Path $PSScriptRoot "launcher.py")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }
Write-Host "Built $app\JJMP3.exe"