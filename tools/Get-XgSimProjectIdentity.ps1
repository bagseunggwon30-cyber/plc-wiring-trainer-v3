[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectPath
)

$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path -LiteralPath $ProjectPath -ErrorAction Stop).Path
$item = Get-Item -LiteralPath $resolved -ErrorAction Stop
if ($item.PSIsContainer) { throw 'ProjectPath must name an XG5000 project file.' }
$hash = Get-FileHash -LiteralPath $resolved -Algorithm SHA256 -ErrorAction Stop
[pscustomobject]@{
  projectPath = $resolved
  projectId = [IO.Path]::GetFileNameWithoutExtension($item.Name)
  length = $item.Length
  lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString('o')
  sha256 = $hash.Hash.ToLowerInvariant()
} | ConvertTo-Json
