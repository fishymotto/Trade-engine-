param(
  [string]$CsvPath,
  [string]$SessionsPath = "$env:APPDATA\com.tradeengine.desktop\trade-sessions.json",
  [string]$OverridesPath = "$env:APPDATA\com.tradeengine.desktop\trade-tag-overrides.json",
  [string]$BackupDirectory = ".\exports",
  [datetime]$StartDate = [datetime]"2026-01-01",
  [datetime]$EndDate = (Get-Date)
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($CsvPath)) {
  throw "CsvPath is required."
}

if (-not (Test-Path -LiteralPath $CsvPath)) {
  throw "CSV file not found: $CsvPath"
}

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

function Normalize-Time([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    return ""
  }

  $trimmed = $value.Trim() -replace "\.0+$", ""
  if ($trimmed -match "^(\d{1,2}):(\d{2}):(\d{2})$") {
    return ("{0:D2}:{1}:{2}" -f [int]$matches[1], $matches[2], $matches[3])
  }

  return $trimmed
}

function Parse-Symbol([string]$rawSymbol, [string]$name) {
  $symbol = $rawSymbol.Trim()
  if ($symbol) {
    return $symbol
  }

  if ($name -match "^\s*([A-Za-z0-9\._-]+)") {
    return $matches[1].Trim()
  }

  return ""
}

function Split-MultiSelect([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) {
    return @()
  }

  return @(
    $value -split ",|;|\r?\n" |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  )
}

function First-OrEmpty([string[]]$values) {
  if ($null -eq $values -or $values.Count -eq 0) {
    return ""
  }

  return [string]$values[0]
}

function Join-ArrayValue($value) {
  return ((@($value) | ForEach-Object {
      if ($null -eq $_) {
        return ""
      }

      return ([string]$_).Trim()
    } | Where-Object { $_ }) -join "||")
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

$rawSessionsJson = Get-Content -Raw -LiteralPath $SessionsPath
$rawSessions = ConvertFrom-Json -InputObject $rawSessionsJson
$sessions = Normalize-JsonRows $rawSessions

$rawOverridesJson = Get-Content -Raw -LiteralPath $OverridesPath
$rawOverrides = ConvertFrom-Json -InputObject $rawOverridesJson
$existingOverrides = Normalize-JsonRows $rawOverrides

$tradeByKey = @{}
foreach ($session in $sessions) {
  foreach ($trade in @($session.trades)) {
    if ($trade.PSObject.Properties.Name -contains "mistakes") {
      Set-ObjectProperty $trade "mistakes" (Normalize-StringList $trade.mistakes)
    }

    $normalizedOpen = Normalize-Time ([string]$trade.openTime)
    $normalizedClose = Normalize-Time ([string]$trade.closeTime)
    $key = "{0}__{1}__{2}__{3}" -f $trade.tradeDate, $trade.symbol, $normalizedOpen, $normalizedClose
    $tradeByKey[$key] = $trade
  }
}

$overrideByKey = @{}
foreach ($override in $existingOverrides) {
  if ($override.PSObject.Properties.Name -contains "mistakes") {
    $normalizedMistakes = Normalize-StringList $override.mistakes
    Set-ObjectProperty $override "mistakes" $normalizedMistakes
    if ($normalizedMistakes.Count -gt 0) {
      Set-ObjectProperty $override "mistake" $normalizedMistakes[0]
    }
  }

  $overrideByKey[[string]$override.key] = $override
}

$rows = Import-Csv -LiteralPath $CsvPath
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$overridesBackupPath = Join-Path $BackupDirectory "trade-tag-overrides.before-notion-import-$timestamp.json"
$sessionsBackupPath = Join-Path $BackupDirectory "trade-sessions.before-notion-import-$timestamp.json"
$unmatchedReportPath = Join-Path $BackupDirectory "notion-trade-tag-import-unmatched-$timestamp.json"

Copy-Item -LiteralPath $OverridesPath -Destination $overridesBackupPath -Force
Copy-Item -LiteralPath $SessionsPath -Destination $sessionsBackupPath -Force

$nowIso = (Get-Date).ToUniversalTime().ToString("o")
$csvRowsInRange = 0
$matchedRows = 0
$newOverrideCount = 0
$updatedOverrideCount = 0
$sessionTradeChanges = 0
$statusChanges = 0
$playbookChanges = 0
$mistakeChanges = 0
$catalystChanges = 0
$gameChanges = 0
$outTagChanges = 0
$executionChanges = 0
$unmatchedRows = New-Object System.Collections.Generic.List[object]

foreach ($row in $rows) {
  $tradeDateRaw = [string]$row.'Trade Date'
  if ([string]::IsNullOrWhiteSpace($tradeDateRaw)) {
    continue
  }

  $tradeDate = [datetime]::Parse($tradeDateRaw)
  if ($tradeDate.Date -lt $StartDate.Date -or $tradeDate.Date -gt $EndDate.Date) {
    continue
  }

  $csvRowsInRange++

  $name = [string]$row.Name
  $symbol = Parse-Symbol ([string]$row.'Symbol (Select)') $name
  $openTime = Normalize-Time ([string]$row.'Open Time')
  $closeTime = Normalize-Time ([string]$row.'Close Time')
  $tradeDateKey = $tradeDate.ToString("yyyy-MM-dd")
  $key = "{0}__{1}__{2}__{3}" -f $tradeDateKey, $symbol, $openTime, $closeTime

  if (-not $tradeByKey.ContainsKey($key)) {
    $unmatchedRows.Add([pscustomobject]@{
      key = $key
      name = $name
      tradeDate = $tradeDateKey
      symbol = $symbol
      openTime = $openTime
      closeTime = $closeTime
      setups = [string]$row.Setups
      mistakes = [string]$row.Mistakes
      status = [string]$row.Status
      game = [string]$row.Game
    }) | Out-Null
    continue
  }

  $matchedRows++
  $trade = $tradeByKey[$key]
  $existingOverride = $overrideByKey[$key]
  $isNewOverride = $null -eq $existingOverride

  if ($isNewOverride) {
    $existingOverride = [pscustomobject]@{
      key = $key
      tradeDate = $tradeDateKey
      symbol = $symbol
      openTime = $openTime
      closeTime = $closeTime
      updatedAt = $nowIso
    }
  }

  $overrideChanged = $false
  $tradeChanged = $false

  $status = ([string]$row.Status).Trim()
  if ($status -and [string]$existingOverride.status -ne $status) {
    $existingOverride | Add-Member -NotePropertyName status -NotePropertyValue $status -Force
    if ([string]$trade.status -ne $status) {
      $trade.status = $status
      $statusChanges++
      $tradeChanged = $true
    }
    $overrideChanged = $true
  }

  $playbook = First-OrEmpty (Split-MultiSelect ([string]$row.Setups))
  if ($playbook -and [string]$existingOverride.playbook -ne $playbook) {
    $existingOverride | Add-Member -NotePropertyName playbook -NotePropertyValue $playbook -Force
    if (Join-ArrayValue $trade.setups -ne $playbook) {
      $trade.setups = @($playbook)
      $playbookChanges++
      $tradeChanged = $true
    }
    $overrideChanged = $true
  }

  $mistakes = Split-MultiSelect ([string]$row.Mistakes)
  if ($mistakes.Count -gt 0) {
    $mistakeValue = Join-ArrayValue $mistakes
    if (Join-ArrayValue $existingOverride.mistakes -ne $mistakeValue) {
      Set-ObjectProperty $existingOverride "mistakes" $mistakes
      Set-ObjectProperty $existingOverride "mistake" $mistakes[0]
      $overrideChanged = $true
    }

    if (Join-ArrayValue $trade.mistakes -ne $mistakeValue) {
      Set-ObjectProperty $trade "mistakes" $mistakes
      $mistakeChanges++
      $tradeChanged = $true
    }
  }

  $catalystRaw = ([string]$row.'Catalyst ').Trim()
  if ($catalystRaw) {
    $catalystValues = @($catalystRaw)
    if (Join-ArrayValue $existingOverride.catalyst -ne (Join-ArrayValue $catalystValues)) {
      $existingOverride | Add-Member -NotePropertyName catalyst -NotePropertyValue $catalystValues -Force
      $overrideChanged = $true
    }

    if (Join-ArrayValue $trade.catalyst -ne (Join-ArrayValue $catalystValues)) {
      $trade.catalyst = $catalystValues
      $catalystChanges++
      $tradeChanged = $true
    }
  }

  $game = ([string]$row.Game).Trim()
  if ($game -and [string]$existingOverride.game -ne $game) {
    $existingOverride | Add-Member -NotePropertyName game -NotePropertyValue $game -Force
    if ([string]$trade.game -ne $game) {
      $trade.game = $game
      $gameChanges++
      $tradeChanged = $true
    }
    $overrideChanged = $true
  }

  $outTag = First-OrEmpty (Split-MultiSelect ([string]$row.'Out Tag'))
  if ($outTag -and [string]$existingOverride.outTag -ne $outTag) {
    $existingOverride | Add-Member -NotePropertyName outTag -NotePropertyValue $outTag -Force
    if (Join-ArrayValue $trade.outTag -ne $outTag) {
      $trade.outTag = @($outTag)
      $outTagChanges++
      $tradeChanged = $true
    }
    $overrideChanged = $true
  }

  $execution = First-OrEmpty (Split-MultiSelect ([string]$row.Execution))
  if ($execution -and [string]$existingOverride.execution -ne $execution) {
    $existingOverride | Add-Member -NotePropertyName execution -NotePropertyValue $execution -Force
    if (Join-ArrayValue $trade.execution -ne $execution) {
      $trade.execution = @($execution)
      $executionChanges++
      $tradeChanged = $true
    }
    $overrideChanged = $true
  }

  if ($overrideChanged) {
    $existingOverride.updatedAt = $nowIso
    $overrideByKey[$key] = $existingOverride
    if ($isNewOverride) {
      $newOverrideCount++
    } else {
      $updatedOverrideCount++
    }
  }

  if ($tradeChanged) {
    $sessionTradeChanges++
  }
}

$mergedOverrides = @($overrideByKey.Values) | Sort-Object tradeDate, symbol, openTime, closeTime
$mergedOverridesJson = ConvertTo-Json -InputObject $mergedOverrides -Depth 100
$sessionsJson = ConvertTo-Json -InputObject $sessions -Depth 100
$unmatchedRowsArray = @($unmatchedRows | ForEach-Object { $_ })
$unmatchedReportJson = ConvertTo-Json -InputObject $unmatchedRowsArray -Depth 20
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$overridesFullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OverridesPath)
$sessionsFullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SessionsPath)
$unmatchedReportFullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($unmatchedReportPath)

[System.IO.File]::WriteAllText($overridesFullPath, $mergedOverridesJson, $utf8NoBom)
[System.IO.File]::WriteAllText($sessionsFullPath, $sessionsJson, $utf8NoBom)
[System.IO.File]::WriteAllText($unmatchedReportFullPath, [string]$unmatchedReportJson, $utf8NoBom)

Write-Output "Imported Notion trade tags into local desktop storage."
Write-Output "csv_rows_in_range=$csvRowsInRange matched_rows=$matchedRows unmatched_rows=$($unmatchedRowsArray.Count)"
Write-Output "new_overrides=$newOverrideCount updated_overrides=$updatedOverrideCount session_trade_changes=$sessionTradeChanges"
Write-Output "status_changes=$statusChanges playbook_changes=$playbookChanges mistake_changes=$mistakeChanges catalyst_changes=$catalystChanges"
Write-Output "game_changes=$gameChanges outtag_changes=$outTagChanges execution_changes=$executionChanges"
Write-Output "overrides_backup=$overridesBackupPath"
Write-Output "sessions_backup=$sessionsBackupPath"
Write-Output "unmatched_report=$unmatchedReportPath"
