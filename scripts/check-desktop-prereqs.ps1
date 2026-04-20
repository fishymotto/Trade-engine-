param(
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

function Add-CheckResult {
  param(
    [string]$Level,
    [string]$Message
  )

  $script:results += [pscustomobject]@{
    Level = $Level
    Message = $Message
  }
}

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

function Get-WebView2Version {
  $clientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  $registryPaths = @(
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$clientId",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$clientId",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$clientId"
  )

  foreach ($path in $registryPaths) {
    if (Test-Path $path) {
      $version = (Get-ItemProperty -Path $path -Name pv -ErrorAction SilentlyContinue).pv
      if ($version) {
        return $version
      }
    }
  }

  return $null
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Split-Path -Parent $scriptDir
$results = @()

$nodePath = Find-CommandPath @("node.exe", "node") @(
  "C:\Program Files\nodejs\node.exe",
  "C:\Program Files (x86)\nodejs\node.exe"
)
if ($nodePath) {
  $nodeVersion = & $nodePath --version
  Add-CheckResult "ok" "Node detected: $nodeVersion at $nodePath"
} else {
  Add-CheckResult "error" "Node.js was not found. Install the Node.js LTS release."
}

$npmPath = Find-CommandPath @("npm.cmd", "npm") @(
  "C:\Program Files\nodejs\npm.cmd",
  "C:\Program Files (x86)\nodejs\npm.cmd"
)
if ($npmPath) {
  $npmVersion = & $npmPath --version
  Add-CheckResult "ok" "npm detected: v$npmVersion at $npmPath"
} else {
  Add-CheckResult "error" "npm was not found. Reinstall Node.js so npm.cmd is available."
}

$cargoPath = Find-CommandPath @("cargo.exe", "cargo") @(
  "$env:USERPROFILE\.cargo\bin\cargo.exe",
  "$env:USERPROFILE\.cargo\bin\cargo"
)
if ($cargoPath) {
  $cargoVersion = & $cargoPath --version
  Add-CheckResult "ok" "Cargo detected: $cargoVersion at $cargoPath"
} else {
  Add-CheckResult "error" "Cargo was not found. Install Rust with the MSVC toolchain."
}

$rustupPath = Find-CommandPath @("rustup.exe", "rustup")
if ($rustupPath) {
  $activeToolchain = (& $rustupPath show active-toolchain) 2>$null
  if ($activeToolchain) {
    if ($activeToolchain -match "msvc") {
      Add-CheckResult "ok" "Rust toolchain is MSVC-based: $activeToolchain"
    } else {
      Add-CheckResult "error" "Rust is installed, but the active toolchain is not MSVC: $activeToolchain"
    }
  } else {
    Add-CheckResult "warning" "rustup is installed, but the active toolchain could not be read."
  }
} elseif ($cargoPath) {
  Add-CheckResult "warning" "Cargo was found, but rustup was not. Verify that the active Rust toolchain is windows-msvc."
}

$vcvarsPath = if (${env:ProgramFiles(x86)}) {
  Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
} else {
  $null
}

if ($vcvarsPath -and (Test-Path $vcvarsPath)) {
  Add-CheckResult "ok" "Visual Studio Build Tools detected at $vcvarsPath"
} else {
  Add-CheckResult "error" "Visual Studio Build Tools 2022 were not found at the expected path."
}

$webView2Version = Get-WebView2Version
if ($webView2Version) {
  Add-CheckResult "ok" "WebView2 runtime detected: $webView2Version"
} else {
  Add-CheckResult "error" "Microsoft Edge WebView2 Runtime was not detected."
}

$nodeModulesPath = Join-Path $projectPath "node_modules"
if (Test-Path $nodeModulesPath) {
  Add-CheckResult "ok" "Project dependencies are installed in node_modules."
} else {
  Add-CheckResult "error" "Project dependencies are missing. Run npm install in $projectPath."
}

$hasErrors = $results.Level -contains "error"

if (-not $Quiet) {
  Write-Host "Trade Engine desktop preflight" -ForegroundColor Cyan
  Write-Host ""

  foreach ($result in $results) {
    switch ($result.Level) {
      "ok" {
        Write-Host "[ok] $($result.Message)" -ForegroundColor Green
      }
      "warning" {
        Write-Host "[warning] $($result.Message)" -ForegroundColor Yellow
      }
      "error" {
        Write-Host "[error] $($result.Message)" -ForegroundColor Red
      }
    }
  }

  if ($hasErrors) {
    Write-Host ""
    Write-Host "Recommended fixes" -ForegroundColor Cyan
    Write-Host "1. Install Node.js LTS."
    Write-Host "   winget install OpenJS.NodeJS.LTS"
    Write-Host "2. Install Rust and switch to the MSVC toolchain."
    Write-Host "   winget install Rustlang.Rustup"
    Write-Host "   rustup default stable-msvc"
    Write-Host "3. Install Visual Studio 2022 Build Tools with the C++ workload."
    Write-Host "   winget install Microsoft.VisualStudio.2022.BuildTools --override ""--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"" --accept-package-agreements --accept-source-agreements"
    Write-Host "4. Install the Microsoft Edge WebView2 Runtime if it is missing."
    Write-Host "   https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
    Write-Host "5. In this repo, run npm install before npm run desktop:dev."
  } else {
    Write-Host ""
    Write-Host "Everything required for npm run desktop:dev is present." -ForegroundColor Green
  }
}

if ($hasErrors) {
  exit 1
}
