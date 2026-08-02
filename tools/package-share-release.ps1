[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packagePath = Join-Path $root 'package.json'
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$version = [string]$package.version
$releaseName = "결선작업장-$version-portable.exe"
$releasePath = Join-Path (Join-Path $root 'release') $releaseName

if (-not (Test-Path -LiteralPath $releasePath -PathType Leaf)) {
  throw "Release artifact is missing: $releasePath. Run npm run build first."
}

$rendererPath = Join-Path $root 'build\renderer\index.html'
if (-not (Test-Path -LiteralPath $rendererPath -PathType Leaf)) {
  throw "Verified renderer build is missing: $rendererPath"
}

$shareDirectory = Join-Path $root 'output\share'
New-Item -ItemType Directory -Path $shareDirectory -Force | Out-Null
$zipPath = Join-Path $shareDirectory "plc-wiring-trainer-$version-windows-x64.zip"
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

$releaseFile = Get-Item -LiteralPath $releasePath
$releaseHash = (Get-FileHash -LiteralPath $releasePath -Algorithm SHA256).Hash
$rendererHash = (Get-FileHash -LiteralPath $rendererPath -Algorithm SHA256).Hash
$manifest = [ordered]@{
  schemaVersion = 1
  product = [string]$package.build.productName
  version = $version
  platform = 'windows-x64-portable'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  artifact = [ordered]@{
    fileName = $releaseName
    sizeBytes = $releaseFile.Length
    sha256 = $releaseHash
  }
  renderer = [ordered]@{
    entry = 'build/renderer/index.html'
    sha256 = $rendererHash
  }
  reviewNotice = '입력된 범위 내 사전 결선 검토 도구이며 실제 통전 승인서가 아닙니다.'
  excludedDevelopmentContent = @(
    'node_modules'
    'release/win-unpacked'
    'pdf'
    'tmp'
    'tests'
    'source and draft image directories'
  )
}
$manifestJson = $manifest | ConvertTo-Json -Depth 6

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open(
  $zipPath,
  [System.IO.Compression.ZipArchiveMode]::Create
)
try {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $archive,
    $releasePath,
    $releaseName,
    [System.IO.Compression.CompressionLevel]::Optimal
  ) | Out-Null
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $archive,
    (Join-Path $root 'README.md'),
    'README.md',
    [System.IO.Compression.CompressionLevel]::Optimal
  ) | Out-Null
  $entry = $archive.CreateEntry('release-manifest.json', [System.IO.Compression.CompressionLevel]::Optimal)
  $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
  try {
    $writer.Write($manifestJson)
  }
  finally {
    $writer.Dispose()
  }
}
finally {
  $archive.Dispose()
}

$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
$zipFile = Get-Item -LiteralPath $zipPath
[pscustomobject]@{
  Path = $zipFile.FullName
  SizeBytes = $zipFile.Length
  Sha256 = $zipHash
  Contents = @($releaseName, 'README.md', 'release-manifest.json')
} | ConvertTo-Json -Depth 3
