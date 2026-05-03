param(
  [string]$SourcePath = ".\exports\trade-tag-overrides.recovered.json",
  [string]$DestinationPath = "$env:APPDATA\com.tradeengine.desktop\trade-tag-overrides.json"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SourcePath)) {
  throw "Recovery file not found: $SourcePath"
}

$sourceRaw = Get-Content -Raw -LiteralPath $SourcePath
$sourceJson = ConvertFrom-Json -InputObject $sourceRaw
$sourceRows =
  if ($sourceJson -is [System.Array]) {
    @($sourceJson)
  } elseif ($sourceJson.PSObject.Properties.Name -contains "value") {
    @($sourceJson.value)
  } else {
    @($sourceJson)
  }

if ($sourceRows.Count -eq 0) {
  throw "Recovery file is empty: $SourcePath"
}

$destinationDir = Split-Path -Parent $DestinationPath
if (-not (Test-Path -LiteralPath $destinationDir)) {
  New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
}

$normalizedJson = ConvertTo-Json -InputObject $sourceRows -Depth 100
$destinationFullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DestinationPath)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($destinationFullPath, $normalizedJson, $utf8NoBom)

$destRaw = Get-Content -Raw -LiteralPath $DestinationPath
$destJson = ConvertFrom-Json -InputObject $destRaw
$destRows =
  if ($destJson -is [System.Array]) {
    @($destJson)
  } elseif ($destJson.PSObject.Properties.Name -contains "value") {
    @($destJson.value)
  } else {
    @($destJson)
  }

$sourcePlaybook = ($sourceRows | Where-Object { $_.playbook -and $_.playbook.Trim().Length -gt 0 }).Count
$destPlaybook = ($destRows | Where-Object { $_.playbook -and $_.playbook.Trim().Length -gt 0 }).Count

Write-Output "Restored tag overrides snapshot."
Write-Output "source_count=$($sourceRows.Count) source_playbook=$sourcePlaybook"
Write-Output "dest_count=$($destRows.Count) dest_playbook=$destPlaybook"
Write-Output "destination=$DestinationPath"
