param(
  [string]$CsvPath = "",
  [string]$DbPath = "$env:LOCALAPPDATA\com.tradeengine.desktop\EBWebView\Default\Local Storage\leveldb",
  [string]$OutputDirectory = ".\exports"
)

$ErrorActionPreference = "Stop"

if (-not $CsvPath.Trim()) {
  throw "Pass the source CSV path with -CsvPath <path>."
}

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
