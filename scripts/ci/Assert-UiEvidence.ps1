[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$EvidenceRoot,

    [Parameter(Mandatory)]
    [int]$MinimumRuns,

    [Parameter(Mandatory)]
    [string]$DisplayProfile,

    [Parameter(Mandatory)]
    [string]$PortableZip
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $EvidenceRoot).Path
$zip = (Resolve-Path -LiteralPath $PortableZip).Path
$errors = @(Get-ChildItem -LiteralPath $root -Recurse -Filter evidence-error.txt -File)
if ($errors.Count -gt 0) {
    throw "UI evidence contains capture errors:`n$($errors.FullName -join "`n")"
}

$runs = @(Get-ChildItem -LiteralPath $root -Recurse -Filter run.txt -File)
if ($runs.Count -lt $MinimumRuns) {
    throw "Expected at least $MinimumRuns UI evidence runs, found $($runs.Count)"
}

$exeHashes = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($run in $runs) {
    [string]$content = Get-Content -LiteralPath $run.FullName -Raw
    if ($content -notmatch "(?m)^displayProfile=$([regex]::Escape($DisplayProfile))\r?$") {
        throw "Display profile evidence mismatch: $($run.FullName)"
    }

    if ($content -notmatch '(?m)^hasExitedAfterCleanup=True\r?$') {
        throw "Clean process exit is not proven: $($run.FullName)"
    }

    if ($content -notmatch '(?m)^sha256=([0-9A-F]{64})\r?$') {
        throw "EXE SHA-256 is missing: $($run.FullName)"
    }

    $null = $exeHashes.Add($Matches[1])
    foreach ($required in 'window.png', 'uia-tree.txt') {
        if (-not (Test-Path -LiteralPath (Join-Path $run.DirectoryName $required) -PathType Leaf)) {
            throw "Required UI evidence is missing: $($run.DirectoryName)\$required"
        }
    }
}

if ($exeHashes.Count -ne 1) {
    throw "UI runs used different executable hashes: $($exeHashes -join ', ')"
}

$zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
$exeHash = @($exeHashes)[0]
$manifest = @(
    "commit=$env:GITHUB_SHA"
    "displayProfile=$DisplayProfile"
    "runCount=$($runs.Count)"
    "portableZipSha256=$zipHash"
    "exeSha256=$exeHash"
)
$manifest | Set-Content -LiteralPath (Join-Path $root 'evidence-manifest.txt') -Encoding utf8NoBOM
"UI evidence verified: runs=$($runs.Count) zipSha256=$zipHash exeSha256=$exeHash"
