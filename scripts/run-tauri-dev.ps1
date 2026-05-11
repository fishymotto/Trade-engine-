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

function Get-DotEnvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  $pattern = "^\s*$([regex]::Escape($Key))\s*=\s*(.*)\s*$"
  $match = Get-Content $Path | Select-String -Pattern $pattern | Select-Object -Last 1
  if (-not $match) {
    return $null
  }

  $rawValue = $match.Matches[0].Groups[1].Value.Trim()
  if (-not $rawValue) {
    return $null
  }

  if (($rawValue.StartsWith('"') -and $rawValue.EndsWith('"')) -or ($rawValue.StartsWith("'") -and $rawValue.EndsWith("'"))) {
    if ($rawValue.Length -ge 2) {
      $rawValue = $rawValue.Substring(1, $rawValue.Length - 2)
    }
  }

  if (-not $rawValue.Trim()) {
    return $null
  }

  return $rawValue.Trim()
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

function Clear-ProblematicDesktopEnv {
  $offlineValue = $env:CARGO_NET_OFFLINE
  if ($offlineValue) {
    $normalizedOffline = $offlineValue.Trim().ToLowerInvariant()
    if ($normalizedOffline -in @("1", "true", "yes", "on")) {
      Remove-Item Env:CARGO_NET_OFFLINE -ErrorAction SilentlyContinue
      Write-Host "Ignoring CARGO_NET_OFFLINE for desktop dev so Cargo can resolve dependencies." -ForegroundColor Yellow
    }
  }

  $proxyVars = @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "GIT_HTTP_PROXY", "GIT_HTTPS_PROXY")
  foreach ($proxyVar in $proxyVars) {
    $proxyValue = (Get-Item "Env:$proxyVar" -ErrorAction SilentlyContinue).Value
    if (-not $proxyValue) {
      continue
    }

    $normalizedProxy = $proxyValue.Trim().ToLowerInvariant().TrimEnd("/")
    if ($normalizedProxy -in @("http://127.0.0.1:9", "https://127.0.0.1:9", "http://localhost:9", "https://localhost:9")) {
      Remove-Item "Env:$proxyVar" -ErrorAction SilentlyContinue
      Write-Host "Ignoring $proxyVar=$proxyValue for desktop dev because it points to an unavailable local proxy." -ForegroundColor Yellow
    }
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Split-Path -Parent $scriptDir

& (Join-Path $scriptDir "check-desktop-prereqs.ps1") -Quiet

$envExamplePath = Join-Path $projectPath ".env.example"
$envLocalPath = Join-Path $projectPath ".env.local"

if (-not (Test-Path $envLocalPath)) {
  if (Test-Path $envExamplePath) {
    Copy-Item -Path $envExamplePath -Destination $envLocalPath -Force
    throw "Created .env.local from .env.example. Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rerun npm run desktop:dev."
  }

  throw "Missing .env.local. Create it at $envLocalPath and set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, then rerun npm run desktop:dev."
}

$supabaseUrl = if ($env:VITE_SUPABASE_URL) { $env:VITE_SUPABASE_URL.Trim() } else { Get-DotEnvValue -Path $envLocalPath -Key "VITE_SUPABASE_URL" }
$supabaseAnonKey = if ($env:VITE_SUPABASE_ANON_KEY) { $env:VITE_SUPABASE_ANON_KEY.Trim() } else { Get-DotEnvValue -Path $envLocalPath -Key "VITE_SUPABASE_ANON_KEY" }

if (-not $supabaseUrl -or -not $supabaseAnonKey) {
  throw "Supabase is not configured for desktop dev. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local, then rerun npm run desktop:dev."
}

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

Clear-ProblematicDesktopEnv

Stop-ListenersOnPort -Port 1420

$command = "`"$vcvarsPath`" && set `"PATH=$nodePath;$cargoPath;%PATH%`" && cd /d `"$projectPath`" && `"$npmPath`" run tauri -- dev --no-watch"

cmd /c $command

if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "desktop:dev failed. If you see 'Access is denied. (os error 5)', retry in a fresh PowerShell session and run:" -ForegroundColor Yellow
  Write-Host "  Remove-Item Env:CARGO_NET_OFFLINE -ErrorAction SilentlyContinue" -ForegroundColor Yellow
  Write-Host "  Remove-Item Env:HTTP_PROXY,Env:HTTPS_PROXY,Env:ALL_PROXY,Env:GIT_HTTP_PROXY,Env:GIT_HTTPS_PROXY -ErrorAction SilentlyContinue" -ForegroundColor Yellow
  exit $LASTEXITCODE
}
