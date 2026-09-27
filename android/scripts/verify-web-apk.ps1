param(
    [string]$ApkPath,
    [string]$WebDist
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $ApkPath) { $ApkPath = Join-Path $repoRoot 'android/app/build/outputs/apk/debug/app-debug.apk' }
if (-not $WebDist) { $WebDist = Join-Path $repoRoot 'web/dist' }
$resolvedApk = (Resolve-Path -LiteralPath $ApkPath).Path
$resolvedDist = (Resolve-Path -LiteralPath $WebDist).Path
if (-not (Test-Path -LiteralPath (Join-Path $resolvedDist 'index.html'))) { throw 'Build web/dist before checking the APK.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($resolvedApk)
try {
    if (@($archive.Entries | Where-Object { $_.FullName.StartsWith('assets/web-assets/') }).Count) {
        throw 'APK contains a duplicate web-assets subtree.'
    }
    $checked = 0
    foreach ($file in Get-ChildItem -LiteralPath $resolvedDist -File -Recurse) {
        $relative = $file.FullName.Substring($resolvedDist.Length).TrimStart('\', '/').Replace('\', '/')
        $entry = $archive.GetEntry('assets/' + $relative)
        if (-not $entry) { throw "APK is missing $relative" }
        $stream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            $actual = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '')
            $expected = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            if ($actual -ne $expected) { throw "APK has a stale or modified asset: $relative" }
        } finally { $stream.Dispose(); $sha.Dispose() }
        $checked++
    }
    [pscustomobject]@{ apk = $resolvedApk; matchedWebFiles = $checked; duplicateBundle = $false } | ConvertTo-Json
} finally { $archive.Dispose() }
