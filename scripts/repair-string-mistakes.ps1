param(
  [string]$SessionsPath = "$env:APPDATA\com.tradeengine.desktop\trade-sessions.json",
  [string]$OverridesPath = "$env:APPDATA\com.tradeengine.desktop\trade-tag-overrides.json",
  [string]$BackupDirectory = ".\exports"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SessionsPath)) {
  throw "Trade sessions file not found: $SessionsPath"
}

if (-not (Test-Path -LiteralPath $OverridesPath)) {
  throw "Trade tag overrides file not found: $OverridesPath"
}

if (-not (Test-Path -LiteralPath $BackupDirectory)) {
  New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
}

function Normalize-JsonRows($value) {
  if ($value -is [System.Array]) {
    return @($value)
  }

  if ($null -ne $value -and $value.PSObject.Properties.Name -contains "value") {
    return @($value.value)
  }

  if ($null -eq $value) {
    return @()
  }

  return @($value)
}

function Normalize-StringList($value) {
  $list = New-Object System.Collections.ArrayList

  if ($value -is [System.Array]) {
    foreach ($entry in $value) {
      if ($null -eq $entry) {
        continue
      }

      $trimmed = ([string]$entry).Trim()
      if ($trimmed) {
        [void]$list.Add($trimmed)
      }
    }

    return $list
  }

  if ($value -is [string]) {
    $trimmed = $value.Trim()
    if ($trimmed) {
      [void]$list.Add($trimmed)
    }

    return $list
  }

  return $list
}

function Set-ObjectProperty($target, [string]$name, $value) {
  if ($target.PSObject.Properties.Name -contains $name) {
    $target.PSObject.Properties.Remove($name)
  }

  $target | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$sessionsBackupPath = Join-Path $BackupDirectory "trade-sessions.before-mistake-shape-repair-$timestamp.json"
$overridesBackupPath = Join-Path $BackupDirectory "trade-tag-overrides.before-mistake-shape-repair-$timestamp.json"

Copy-Item -LiteralPath $SessionsPath -Destination $sessionsBackupPath -Force
Copy-Item -LiteralPath $OverridesPath -Destination $overridesBackupPath -Force

$sessionsRaw = Get-Content -Raw -LiteralPath $SessionsPath | ConvertFrom-Json
$sessions = Normalize-JsonRows $sessionsRaw

$sessionTradeFixes = 0
foreach ($session in $sessions) {
  foreach ($trade in @($session.trades)) {
    if ($trade.PSObject.Properties.Name -contains "mistakes" -and $trade.mistakes -is [string]) {
      Set-ObjectProperty $trade "mistakes" (Normalize-StringList $trade.mistakes)
      $sessionTradeFixes++
    }
  }
}

$overridesRaw = Get-Content -Raw -LiteralPath $OverridesPath | ConvertFrom-Json
$overrides = Normalize-JsonRows $overridesRaw

$overrideFixes = 0
foreach ($override in $overrides) {
  if ($override.PSObject.Properties.Name -contains "mistakes" -and $override.mistakes -is [string]) {
    $normalizedMistakes = Normalize-StringList $override.mistakes
    Set-ObjectProperty $override "mistakes" $normalizedMistakes
    if (@($normalizedMistakes).Count -gt 0) {
      Set-ObjectProperty $override "mistake" $normalizedMistakes[0]
    }
    $overrideFixes++
  }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$sessionsJson = ConvertTo-Json -InputObject $sessions -Depth 100
$overridesJson = ConvertTo-Json -InputObject $overrides -Depth 100

$sessionsFullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SessionsPath)
$overridesFullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OverridesPath)

[System.IO.File]::WriteAllText($sessionsFullPath, $sessionsJson, $utf8NoBom)
[System.IO.File]::WriteAllText($overridesFullPath, $overridesJson, $utf8NoBom)

Write-Output "Repaired string-shaped mistake tags."
Write-Output "session_trade_fixes=$sessionTradeFixes"
Write-Output "override_fixes=$overrideFixes"
Write-Output "sessions_backup=$sessionsBackupPath"
Write-Output "overrides_backup=$overridesBackupPath"
