[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$PublishRoot
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PublishRoot).Path
$manifestPath = Join-Path $root 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "SHA256SUMS.txt is missing: $manifestPath"
}

$entries = Get-Content -LiteralPath $manifestPath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
if ($entries.Count -eq 0) {
    throw 'SHA256SUMS.txt is empty'
}

$listedPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($entry in $entries) {
    if ($entry -notmatch '^([0-9A-Fa-f]{64})  (.+)$') {
        throw "Invalid SHA-256 manifest entry: $entry"
    }

    $expected = $Matches[1].ToUpperInvariant()
    $relative = $Matches[2].Replace('/', [IO.Path]::DirectorySeparatorChar)
    $path = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $path.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Manifest path escapes publish root: $relative"
    }

    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Manifest file is missing: $relative"
    }

    if (-not $listedPaths.Add($path)) {
        throw "Duplicate manifest path: $relative"
    }

    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($actual -ne $expected) {
        throw "SHA-256 mismatch: $relative"
    }
}

$unlisted = Get-ChildItem -LiteralPath $root -Recurse -File |
    Where-Object { $_.FullName -ne $manifestPath -and -not $listedPaths.Contains($_.FullName) }
if ($unlisted) {
    throw "Portable artifact contains files not covered by SHA256SUMS.txt:`n$($unlisted.FullName -join "`n")"
}

$executablePath = Join-Path $root 'PlcWiringTrainer.exe'
if (-not $listedPaths.Contains($executablePath)) {
    throw 'PlcWiringTrainer.exe is not covered by SHA256SUMS.txt'
}

$executableHash = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash
"Verified $($entries.Count) portable manifest entries. exeSha256=$executableHash"
