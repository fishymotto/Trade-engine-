$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Split-Path -Parent $scriptDir

& (Join-Path $scriptDir "check-desktop-prereqs.ps1") -Quiet

$vcvarsPath = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if (-not (Test-Path $vcvarsPath)) {
  throw "Visual Studio Build Tools were not found at '$vcvarsPath'."
}

$npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
$cargoBinaryPath = (Get-Command cargo.exe -ErrorAction Stop).Source
$nodePath = Split-Path -Parent $npmPath
$cargoPath = Split-Path -Parent $cargoBinaryPath

$command = "`"$vcvarsPath`" && set `"PATH=$nodePath;$cargoPath;%PATH%`" && cd /d `"$projectPath`" && npm.cmd run tauri dev"

cmd /c $command

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
