$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'native\xgsim-host\XgSimHost.csproj'
$candidates = [System.Collections.Generic.List[string]]::new()

if ($env:XGSIM_MSBUILD_PATH) {
  $candidates.Add($env:XGSIM_MSBUILD_PATH)
}

$vswhereCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }

foreach ($vswhere in $vswhereCandidates) {
  $discovered = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe'
  if ($LASTEXITCODE -eq 0) {
    foreach ($path in $discovered) {
      if ($path) { $candidates.Add($path) }
    }
  }
}

foreach ($edition in @('BuildTools', 'Community', 'Professional', 'Enterprise')) {
  $candidates.Add("C:\Program Files (x86)\Microsoft Visual Studio\2022\$edition\MSBuild\Current\Bin\MSBuild.exe")
}

$msbuild = $candidates |
  Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
  Select-Object -First 1

if (-not $msbuild) {
  throw @"
XG-SIM host build requires Visual Studio 2022 Build Tools with MSBuild and the .NET Framework 4.7.2 targeting pack.
MSBuild was not found through vswhere, XGSIM_MSBUILD_PATH, or the standard Visual Studio 2022 installation paths.
Run 'npm start' to use the wiring and 3D training rooms without the optional XG-SIM host.
Run 'npm run build:offline' to create a portable package without the optional XG-SIM host.
"@
}

$targetingPack = Join-Path ${env:ProgramFiles(x86)} 'Reference Assemblies\Microsoft\Framework\.NETFramework\v4.7.2\mscorlib.dll'
if (-not (Test-Path -LiteralPath $targetingPack -PathType Leaf)) {
  throw @"
MSBuild was found at: $msbuild
The .NET Framework 4.7.2 targeting pack was not found at: $targetingPack
Install the Visual Studio individual component '.NET Framework 4.7.2 targeting pack', then retry.
"@
}

Write-Host "Using MSBuild: $msbuild"

& $msbuild $project /t:Build /p:Configuration=Release /p:Platform=x86 /m:1 /v:minimal
if ($LASTEXITCODE -ne 0) { throw "xgsim-host x86 build failed with exit code $LASTEXITCODE" }
