param(
  [switch]$SkipBuild
)

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

  $trimmed = $rawValue.Trim()
  if (-not $trimmed) {
    return $null
  }

  return $trimmed
}

function Clear-ProblematicDesktopEnv {
  $offlineValue = $env:CARGO_NET_OFFLINE
  if ($offlineValue) {
    $normalizedOffline = $offlineValue.Trim().ToLowerInvariant()
    if ($normalizedOffline -in @("1", "true", "yes", "on")) {
      Remove-Item Env:CARGO_NET_OFFLINE -ErrorAction SilentlyContinue
      Write-Host "Ignoring CARGO_NET_OFFLINE for the desktop release so Cargo can resolve dependencies." -ForegroundColor Yellow
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
      Write-Host "Ignoring $proxyVar=$proxyValue for the desktop release because it points to an unavailable local proxy." -ForegroundColor Yellow
    }
  }
}

function Get-FirstExistingFile {
  param(
    [string[]]$Paths
  )

  foreach ($path in $Paths) {
    if (Test-Path $path) {
      return $path
    }
  }

  return $null
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Split-Path -Parent $scriptDir
$packageJsonPath = Join-Path $projectPath "package.json"
$envLocalPath = Join-Path $projectPath ".env.local"
$bundleRoot = Join-Path $projectPath "src-tauri\target\release\bundle"
$releaseRoot = Join-Path $projectPath "dist\work-pc"
$version = ((Get-Content $packageJsonPath -Raw) | ConvertFrom-Json).version
$stagedReleasePath = Join-Path $releaseRoot "Trade-Engine-$version"

if (-not $SkipBuild) {
  & (Join-Path $scriptDir "check-desktop-prereqs.ps1") -Quiet

  $vcvarsPath = if (${env:ProgramFiles(x86)}) {
    Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
  } else {
    $null
  }

  if (-not $vcvarsPath -or -not (Test-Path $vcvarsPath)) {
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

  $supabaseUrl = if ($env:VITE_SUPABASE_URL) { $env:VITE_SUPABASE_URL.Trim() } else { Get-DotEnvValue -Path $envLocalPath -Key "VITE_SUPABASE_URL" }
  $supabaseAnonKey = if ($env:VITE_SUPABASE_ANON_KEY) { $env:VITE_SUPABASE_ANON_KEY.Trim() } else { Get-DotEnvValue -Path $envLocalPath -Key "VITE_SUPABASE_ANON_KEY" }

  if (-not $supabaseUrl -or -not $supabaseAnonKey) {
    Write-Host "Supabase env vars were not found. This build will still run, but it will be local-only until you rebuild with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set." -ForegroundColor Yellow
  }

  Write-Host "Building Trade Engine desktop installers..." -ForegroundColor Cyan
  $command = "`"$vcvarsPath`" && set `"PATH=$nodePath;$cargoPath;%PATH%`" && cd /d `"$projectPath`" && `"$npmPath`" run tauri -- build"
  cmd /c $command

  if ($LASTEXITCODE -ne 0) {
    throw "desktop:work-pc build failed."
  }
}

$nsisInstaller = Get-FirstExistingFile @(
  (Join-Path $bundleRoot "nsis\Trade Engine_${version}_x64-setup.exe"),
  (Join-Path $bundleRoot "nsis\Trade Engine_0.1.0_x64-setup.exe")
)
$msiInstaller = Get-FirstExistingFile @(
  (Join-Path $bundleRoot "msi\Trade Engine_${version}_x64_en-US.msi"),
  (Join-Path $bundleRoot "msi\Trade Engine_0.1.0_x64_en-US.msi")
)

if (-not $nsisInstaller -and -not $msiInstaller) {
  throw "No packaged installer was found in $bundleRoot. Run the build again without -SkipBuild once Tauri bundling succeeds."
}

if (Test-Path $stagedReleasePath) {
  Remove-Item -Recurse -Force -LiteralPath $stagedReleasePath
}

New-Item -ItemType Directory -Path $stagedReleasePath | Out-Null

if ($nsisInstaller) {
  Copy-Item -LiteralPath $nsisInstaller -Destination (Join-Path $stagedReleasePath (Split-Path $nsisInstaller -Leaf))
}

if ($msiInstaller) {
  Copy-Item -LiteralPath $msiInstaller -Destination (Join-Path $stagedReleasePath (Split-Path $msiInstaller -Leaf))
}

$installGuide = @"
Trade Engine work PC package
============================

Install on the work PC
1. Copy this whole folder to the work PC.
2. Install Microsoft Edge WebView2 Runtime if the PC does not already have it:
   https://developer.microsoft.com/en-us/microsoft-edge/webview2/
3. Run the EXE installer if Windows allows it. If your workplace prefers MSI deployment, use the MSI file instead.
4. If Windows SmartScreen appears, choose More info -> Run anyway only if you trust this build.

Move your data
1. If this build was created with Supabase env vars, sign in on both computers and let sync hydrate the workspace.
2. If you want to move local-only data, open the Imports page and use Send Workspace on the current PC.
3. Copy the exported transfer bundle to the work PC.
4. On the work PC, open the Imports page, switch to Receive Workspace, and import it.

Notes
- `exportFolder` stays machine-local, so set it again on the work PC after install.
- Playbook attachments inside transfer files are included when they live under the app's playbook attachments folder.
- A build made without Supabase env vars still works, but sign-in and cloud sync stay disabled until you rebuild with those vars present.
"@

$guidePath = Join-Path $stagedReleasePath "WORK-PC-INSTALL.txt"
Set-Content -LiteralPath $guidePath -Value $installGuide -NoNewline

Write-Host ""
Write-Host "Work PC package staged at:" -ForegroundColor Green
Write-Host "  $stagedReleasePath" -ForegroundColor Green

if ($nsisInstaller) {
  Write-Host "Included installer: $(Split-Path $nsisInstaller -Leaf)" -ForegroundColor Green
}

if ($msiInstaller) {
  Write-Host "Included installer: $(Split-Path $msiInstaller -Leaf)" -ForegroundColor Green
}

Write-Host "Included guide: WORK-PC-INSTALL.txt" -ForegroundColor Green
