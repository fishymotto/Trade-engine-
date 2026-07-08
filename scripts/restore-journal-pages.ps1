param(
  [string]$SourcePath = "",
  [string]$DestinationPath = "$env:APPDATA\com.tradeengine.desktop\journal-pages.json"
)

$ErrorActionPreference = "Stop"

if (-not $SourcePath.Trim()) {
  throw "Pass the recovered journal pages path with -SourcePath <path>."
}

if (-not (Test-Path -LiteralPath $SourcePath)) {
  throw "Recovered journal pages file not found: $SourcePath"
}

$sourceRaw = Get-Content -Raw -LiteralPath $SourcePath
$parsedPages = ConvertFrom-Json -InputObject $sourceRaw
$pages =
  if ($parsedPages -is [System.Array]) {
    @($parsedPages)
  } elseif ($parsedPages.PSObject.Properties.Name -contains "value") {
    @($parsedPages.value)
  } else {
    @($parsedPages)
  }
if ($pages.Count -eq 0) {
  throw "Recovered journal pages file is empty: $SourcePath"
}

$destinationDir = Split-Path -Parent $DestinationPath
if (-not (Test-Path -LiteralPath $destinationDir)) {
  New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
}

$normalizedJson = ConvertTo-Json -InputObject $pages -Depth 100
$destinationFullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DestinationPath)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($destinationFullPath, $normalizedJson, $utf8NoBom)

function Get-DocTextLength($node) {
  if ($null -eq $node) {
    return 0
  }

  $total = 0
  if ($node.PSObject.Properties["text"] -and $node.text) {
    $total += ([string]$node.text).Trim().Length
  }

  if ($node.PSObject.Properties["content"] -and $node.content) {
    foreach ($child in @($node.content)) {
      $total += Get-DocTextLength $child
    }
  }

  return $total
}

$fields = @(
  "morningContent",
  "closingContent",
  "mppPlanContent",
  "inPlayStocksContent",
  "traderReachOutsContent",
  "notesContent"
)

$pagesWithText = 0
$totalText = 0
foreach ($page in $pages) {
  $pageText = 0
  foreach ($field in $fields) {
    if ($page.PSObject.Properties[$field]) {
      $pageText += Get-DocTextLength $page.$field
    }
  }

  if ($pageText -gt 0) {
    $pagesWithText++
  }

  $totalText += $pageText
}

Write-Output "Restored journal pages snapshot."
Write-Output "pages=$($pages.Count) pages_with_text=$pagesWithText total_text_chars=$totalText"
Write-Output "destination=$DestinationPath"
