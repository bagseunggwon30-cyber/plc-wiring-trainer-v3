$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'native\xgsim-host\XgSimHost.csproj'
$msbuild = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe'

if (-not (Test-Path -LiteralPath $msbuild -PathType Leaf)) {
  throw @"
XG-SIM host build requires Visual Studio 2022 Build Tools with MSBuild and the .NET Framework 4.7.2 targeting pack.
MSBuild was not found at the approved Build Tools path: $msbuild
Run 'npm start' to use the wiring and 3D training rooms without the optional XG-SIM host.
"@
}

& $msbuild $project /t:Build /p:Configuration=Release /p:Platform=x86 /m:1 /v:minimal
if ($LASTEXITCODE -ne 0) { throw "xgsim-host x86 build failed with exit code $LASTEXITCODE" }
