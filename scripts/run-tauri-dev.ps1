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

$command = "`"$vcvarsPath`" && set `"PATH=$nodePath;$cargoPath;%PATH%`" && cd /d `"$projectPath`" && npm.cmd run tauri dev"

cmd /c $command

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
