$ErrorActionPreference = "Stop"

$vcvarsPath = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if (-not (Test-Path $vcvarsPath)) {
  throw "Visual Studio Build Tools were not found at '$vcvarsPath'."
}

$nodePath = "C:\Program Files\nodejs"
$cargoPath = Join-Path $env:USERPROFILE ".cargo\bin"
$projectPath = Split-Path -Parent $PSScriptRoot

$command = "`"$vcvarsPath`" && set `"PATH=$nodePath;$cargoPath;%PATH%`" && cd /d `"$projectPath`" && npm.cmd run tauri dev"

cmd /c $command
