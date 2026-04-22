$ErrorActionPreference = "Stop"

function Find-CommandPath {
  param(
    [string[]]$Names,
    [string[]]$FallbackPaths = @()
  )

  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  foreach ($path in $FallbackPaths) {
    if (Test-Path $path) {
      return $path
    }
  }

  return $null
}

function Get-ListeningProcessIdsForPort {
  param(
    [int]$Port
  )

  $processIds = @()

  try {
    $processIds = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch {
    $processIds = @()
  }

  if ($processIds -and $processIds.Count -gt 0) {
    return $processIds | Sort-Object -Unique
  }

  $netstatOutput = netstat -ano | Select-String -Pattern "LISTENING\s+(\d+)$"
  $matchedIds = @()

  foreach ($line in $netstatOutput) {
    $text = $line.Line
    if ($text -match "[:\.]$Port\s+.*LISTENING\s+(\d+)$") {
      $matchedIds += [int]$Matches[1]
    }
  }

  return $matchedIds | Sort-Object -Unique
}

function Stop-ListenersOnPort {
  param(
    [int]$Port
  )

  $processIds = Get-ListeningProcessIdsForPort -Port $Port
  if (-not $processIds -or $processIds.Count -eq 0) {
    return
  }

  Write-Host "Port $Port is already in use. Stopping stale process(es): $($processIds -join ', ')" -ForegroundColor Yellow

  foreach ($processId in $processIds) {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      Write-Warning "Could not stop process $processId on port $Port. Please close it manually and retry."
    }
  }

  Start-Sleep -Milliseconds 250
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Split-Path -Parent $scriptDir

& (Join-Path $scriptDir "check-desktop-prereqs.ps1") -Quiet

$vcvarsPath = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if (-not (Test-Path $vcvarsPath)) {
  throw "Visual Studio Build Tools were not found at '$vcvarsPath'."
}

$npmPath = Find-CommandPath @("npm.cmd", "npm") @(
  "C:\Program Files\nodejs\npm.cmd",
  "C:\Program Files (x86)\nodejs\npm.cmd"
)
if (-not $npmPath) {
  throw "npm was not found. Install Node.js LTS or add it to PATH."
}

$cargoBinaryPath = Find-CommandPath @("cargo.exe", "cargo") @(
  "$env:USERPROFILE\.cargo\bin\cargo.exe",
  "$env:USERPROFILE\.cargo\bin\cargo"
)
if (-not $cargoBinaryPath) {
  throw "Cargo was not found. Install Rust with the MSVC toolchain."
}

$nodePath = Split-Path -Parent $npmPath
$cargoPath = Split-Path -Parent $cargoBinaryPath

Stop-ListenersOnPort -Port 1420

$command = "`"$vcvarsPath`" && set `"PATH=$nodePath;$cargoPath;%PATH%`" && cd /d `"$projectPath`" && npm.cmd run tauri -- dev --no-watch"

cmd /c $command

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
