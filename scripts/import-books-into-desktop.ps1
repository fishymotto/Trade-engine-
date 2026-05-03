param(
  [string]$CsvPath = "C:\Users\Owner\Downloads\55b016fe-7d8c-4caf-be1e-5ddf842acf28_ExportBlock-9bad0c10-48b3-4581-b77f-db8274d2aa30\ExportBlock-9bad0c10-48b3-4581-b77f-db8274d2aa30-Part-1\Trading and Poker Books 25dc45aecf4980459e91e3e7b4f5ade4.csv",
  [string]$DbPath = "$env:LOCALAPPDATA\com.tradeengine.desktop\EBWebView\Default\Local Storage\leveldb",
  [string]$OutputDirectory = ".\exports"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $CsvPath)) {
  throw "CSV file not found: $CsvPath"
}

if (-not (Test-Path -LiteralPath $DbPath)) {
  throw "Desktop LevelDB path not found: $DbPath"
}

$scriptPath = Join-Path $PSScriptRoot "import-books-webview-leveldb.mjs"
if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "Importer script missing: $scriptPath"
}

node $scriptPath --csv $CsvPath --db $DbPath --out $OutputDirectory
