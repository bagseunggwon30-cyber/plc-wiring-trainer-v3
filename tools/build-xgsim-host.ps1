$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'native\xgsim-host\XgSimHost.csproj'
$msbuild = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe'

if (-not (Test-Path -LiteralPath $msbuild -PathType Leaf)) {
  throw "MSBuild was not found at the approved Build Tools path: $msbuild"
}

& $msbuild $project /t:Build /p:Configuration=Release /p:Platform=x86 /m:1 /v:minimal
if ($LASTEXITCODE -ne 0) { throw "xgsim-host x86 build failed with exit code $LASTEXITCODE" }
