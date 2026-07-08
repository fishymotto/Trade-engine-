param(
  [string]$SessionsPath = "$env:APPDATA\com.tradeengine.desktop\trade-sessions.json",
  [string]$OverridesPath = "",
  [string]$BackupDirectory = ".\exports"
)

$ErrorActionPreference = "Stop"

if (-not $OverridesPath.Trim()) {
  throw "Pass the recovered trade tag overrides path with -OverridesPath <path>."
}

if (-not (Test-Path -LiteralPath $SessionsPath)) {
  throw "Trade sessions file not found: $SessionsPath"
}

if (-not (Test-Path -LiteralPath $OverridesPath)) {
  throw "Recovered overrides file not found: $OverridesPath"
}

if (-not (Test-Path -LiteralPath $BackupDirectory)) {
  New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
}

$rawSessionsJson = Get-Content -Raw -LiteralPath $SessionsPath
$rawSessions = ConvertFrom-Json -InputObject $rawSessionsJson
$sessions =
  if ($rawSessions -is [System.Array]) {
    @($rawSessions)
  } elseif ($rawSessions.PSObject.Properties.Name -contains "value") {
    @($rawSessions.value)
  } else {
    @($rawSessions)
  }

$rawOverridesJson = Get-Content -Raw -LiteralPath $OverridesPath
$rawOverrides = ConvertFrom-Json -InputObject $rawOverridesJson
$overrides =
  if ($rawOverrides -is [System.Array]) {
    @($rawOverrides)
  } elseif ($rawOverrides.PSObject.Properties.Name -contains "value") {
    @($rawOverrides.value)
  } else {
    @($rawOverrides)
  }

$overrideByKey = @{}
foreach ($override in $overrides) {
  $overrideByKey[[string]$override.key] = $override
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $BackupDirectory "trade-sessions.before-tag-restore-$timestamp.json"
Copy-Item -LiteralPath $SessionsPath -Destination $backupPath -Force

$changedTrades = 0
$playbookChanges = 0
$mistakeChanges = 0
$catalystChanges = 0
$gameChanges = 0
$outTagChanges = 0
$executionChanges = 0
$statusChanges = 0

foreach ($session in $sessions) {
  foreach ($trade in @($session.trades)) {
    $key = "{0}__{1}__{2}__{3}" -f $trade.tradeDate, $trade.symbol, $trade.openTime, $trade.closeTime
    if (-not $overrideByKey.ContainsKey($key)) {
      continue
    }

    $override = $overrideByKey[$key]
    $tradeChanged = $false
    $propertyNames = @($override.PSObject.Properties.Name)

    if ($propertyNames -contains "status" -and $override.status) {
      if ($trade.status -ne $override.status) {
        $trade.status = $override.status
        $statusChanges++
        $tradeChanged = $true
      }
    }

    if ($propertyNames -contains "mistakes") {
      $nextMistakes = @($override.mistakes)
      $currentMistakes = @($trade.mistakes)
      if ((($currentMistakes | ForEach-Object {[string]$_}) -join "||") -ne (($nextMistakes | ForEach-Object {[string]$_}) -join "||")) {
        $trade.mistakes = $nextMistakes
        $mistakeChanges++
        $tradeChanged = $true
      }
    } elseif ($propertyNames -contains "mistake") {
      $nextMistakes = if ($override.mistake) { @([string]$override.mistake) } else { @() }
      $currentMistakes = @($trade.mistakes)
      if ((($currentMistakes | ForEach-Object {[string]$_}) -join "||") -ne (($nextMistakes | ForEach-Object {[string]$_}) -join "||")) {
        $trade.mistakes = $nextMistakes
        $mistakeChanges++
        $tradeChanged = $true
      }
    }

    if ($propertyNames -contains "playbook") {
      $nextSetups = if ($null -ne $override.playbook -and [string]$override.playbook -ne "") {
        @([string]$override.playbook)
      } else {
        @()
      }
      $currentSetups = @($trade.setups)
      if ((($currentSetups | ForEach-Object {[string]$_}) -join "||") -ne (($nextSetups | ForEach-Object {[string]$_}) -join "||")) {
        $trade.setups = $nextSetups
        $playbookChanges++
        $tradeChanged = $true
      }
    }

    if ($propertyNames -contains "catalyst") {
      $nextCatalyst = @($override.catalyst)
      $currentCatalyst = @($trade.catalyst)
      if ((($currentCatalyst | ForEach-Object {[string]$_}) -join "||") -ne (($nextCatalyst | ForEach-Object {[string]$_}) -join "||")) {
        $trade.catalyst = $nextCatalyst
        $catalystChanges++
        $tradeChanged = $true
      }
    }

    if ($propertyNames -contains "game") {
      $nextGame = if ($null -ne $override.game) { [string]$override.game } else { "" }
      if ([string]$trade.game -ne $nextGame) {
        $trade.game = $nextGame
        $gameChanges++
        $tradeChanged = $true
      }
    }

    if ($propertyNames -contains "outTag") {
      $nextOutTag = if ($null -ne $override.outTag -and [string]$override.outTag -ne "") {
        @([string]$override.outTag)
      } else {
        @()
      }
      $currentOutTag = @($trade.outTag)
      if ((($currentOutTag | ForEach-Object {[string]$_}) -join "||") -ne (($nextOutTag | ForEach-Object {[string]$_}) -join "||")) {
        $trade.outTag = $nextOutTag
        $outTagChanges++
        $tradeChanged = $true
      }
    }

    if ($propertyNames -contains "execution") {
      $nextExecution = if ($null -ne $override.execution -and [string]$override.execution -ne "") {
        @([string]$override.execution)
      } else {
        @()
      }
      $currentExecution = @($trade.execution)
      if ((($currentExecution | ForEach-Object {[string]$_}) -join "||") -ne (($nextExecution | ForEach-Object {[string]$_}) -join "||")) {
        $trade.execution = $nextExecution
        $executionChanges++
        $tradeChanged = $true
      }
    }

    if ($tradeChanged) {
      $changedTrades++
    }
  }
}

$sessionsJson = ConvertTo-Json -InputObject $sessions -Depth 100
$sessionsFullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($SessionsPath)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($sessionsFullPath, $sessionsJson, $utf8NoBom)

Write-Output "Restored recovered manual tags into saved trade sessions."
Write-Output "changed_trades=$changedTrades"
Write-Output "playbook_changes=$playbookChanges mistake_changes=$mistakeChanges catalyst_changes=$catalystChanges"
Write-Output "game_changes=$gameChanges outtag_changes=$outTagChanges execution_changes=$executionChanges status_changes=$statusChanges"
Write-Output "backup_path=$backupPath"
Write-Output "sessions_path=$SessionsPath"
