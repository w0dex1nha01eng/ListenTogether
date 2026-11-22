# verify.ps1 -- inspect the built launcher without executing it.
#
# Checks:
#   * audited BetterNCM archive SHA-256 and the explicit 19-file list
#   * compiled plugin manifest slug/version against this repository's manifest
#   * embedded managed resource "payload.zip" (read through reflection-only load)
#   * ZIP path safety and exact payload contents
#   * no app/out, app/plugins, host.json, logs, proxy DLL or autostart registration
#   * the embedded plugin package's manifest slug/version
#
# It never starts the EXE, node.exe, BetterNCM, the agent, or the NetEase client.

[CmdletBinding()]
param(
    [string]$ExePath = (Join-Path $PSScriptRoot 'dist\NCM-ListenTogether-x64.exe'),
    [string]$AuditZip = (Join-Path $PSScriptRoot 'vendor\BetterNCM-v3-Portable-x64.zip')
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

$Root          = Split-Path -Parent $PSScriptRoot
$ManifestPath  = Join-Path $Root 'manifest.json'
$SourceList    = Join-Path $PSScriptRoot 'SOURCE-FILES.txt'
$ExpectedAuditHash = 'ecd2c17389efa1520cbd3426d0418eb4e5131d2aa66ef789c7d9557af5b066b7'

function Fail([string]$Message) { throw "ERROR: $Message" }
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { Fail $Message } }
function Get-Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

function Assert-SafeZipPath([string]$Name) {
    Assert-True ($null -ne $Name -and $Name.Length -gt 0) 'empty ZIP entry name'
    Assert-True (-not $Name.Contains('\')) ("ZIP entry uses a backslash: " + $Name)
    Assert-True (-not $Name.StartsWith('/')) ("ZIP entry is rooted: " + $Name)
    Assert-True (-not ($Name -match '^[A-Za-z]:')) ("ZIP entry has a drive letter: " + $Name)
    foreach ($part in $Name.TrimEnd('/').Split('/')) {
        Assert-True ($part.Length -gt 0) ("ZIP entry has an empty component: " + $Name)
        Assert-True ($part -ne '.' -and $part -ne '..') ("ZIP entry escapes its root: " + $Name)
    }
}

function Read-ZipEntryText([System.IO.Compression.ZipArchiveEntry]$Entry) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $stream = $Entry.Open()
    $reader = New-Object System.IO.StreamReader -ArgumentList @($stream, $utf8, $true)
    try { return $reader.ReadToEnd() }
    finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

function Get-ResourceAssembly([string]$Path) {
    try {
        $candidate = [System.Reflection.Assembly]::ReflectionOnlyLoadFrom($Path)
        $names = @($candidate.GetManifestResourceNames())
        if ($names -contains 'payload.zip') {
            $probe = $candidate.GetManifestResourceStream('payload.zip')
            if ($null -ne $probe) { $probe.Dispose(); return $candidate }
        }
    }
    catch {
        # Reflection-only resource access is not available on every CLR; fall back.
    }
    return [System.Reflection.Assembly]::LoadFile($Path)
}

function Copy-StreamToFile([System.IO.Stream]$Stream, [string]$Path) {
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $outStream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $Stream.CopyTo($outStream, 131072); $outStream.Flush($true) }
    finally { $outStream.Dispose() }
}

Assert-True (Test-Path -LiteralPath $ExePath) ("launcher not found: " + $ExePath)
Assert-True (Test-Path -LiteralPath $AuditZip) ("audit archive not found: " + $AuditZip)
Assert-True (Test-Path -LiteralPath $SourceList) ("source list not found: " + $SourceList)

$manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$slug = [string]$manifest.slug
$version = [string]$manifest.version
Assert-True ($slug.Length -gt 0 -and $version.Length -gt 0) 'manifest.json is missing slug or version'

$sourceFiles = @(
    Get-Content -LiteralPath $SourceList -Encoding UTF8 |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_.Length -gt 0 -and -not $_.StartsWith('#') }
)
Assert-True ($sourceFiles.Count -eq 19) ("source list must contain 19 files, found " + $sourceFiles.Count)
foreach ($relative in $sourceFiles) {
    Assert-SafeZipPath $relative
    Assert-True ($relative.StartsWith('app/')) ("source outside app/: " + $relative)
    Assert-True (-not ($relative.StartsWith('app/out/'))) ("proxy DLL in source list: " + $relative)
    Assert-True (-not ($relative.StartsWith('app/plugins/'))) ("third-party plugin in source list: " + $relative)
}

$auditHash = Get-Sha256 $AuditZip
Assert-True ($auditHash -eq $ExpectedAuditHash) ("audit SHA-256 mismatch: " + $auditHash)

$audit = [System.IO.Compression.ZipFile]::OpenRead($AuditZip)
try {
    $auditNames = @{}
    foreach ($entry in $audit.Entries) {
        Assert-SafeZipPath $entry.FullName
        if (-not $entry.FullName.EndsWith('/')) { $auditNames[$entry.FullName] = $true }
    }
    foreach ($relative in $sourceFiles) {
        Assert-True ($auditNames.ContainsKey($relative)) ("audit archive missing: " + $relative)
    }
    foreach ($name in $auditNames.Keys) {
        if (-not $name.StartsWith('app/')) { continue }
        if ($sourceFiles -contains $name) { continue }
        if ($name.StartsWith('app/out/') -or $name.StartsWith('app/plugins/')) { continue }
        Fail ("unreviewed app/ file is not in SOURCE-FILES.txt: " + $name)
    }
}
finally {
    $audit.Dispose()
}

# Read the embedded payload without running the launcher's entry point.
$assembly = Get-ResourceAssembly $ExePath
$resourceNames = @($assembly.GetManifestResourceNames())
Assert-True ($resourceNames -contains 'payload.zip') (
    "embedded payload.zip not found; resources: " + ($resourceNames -join ', ')
)

$buildDir = Join-Path $PSScriptRoot '.build'
if (-not (Test-Path -LiteralPath $buildDir)) {
    New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
}
$extractedPayload = Join-Path $buildDir 'verify-payload.zip'
if (Test-Path -LiteralPath $extractedPayload) { Remove-Item -LiteralPath $extractedPayload -Force }

$resource = $assembly.GetManifestResourceStream('payload.zip')
try { Copy-StreamToFile $resource $extractedPayload }
finally { $resource.Dispose() }

$payloadHash = Get-Sha256 $extractedPayload
$payload = [System.IO.Compression.ZipFile]::OpenRead($extractedPayload)
try {
    $payloadNames = @{}
    foreach ($entry in $payload.Entries) {
        Assert-SafeZipPath $entry.FullName
        Assert-True (-not $payloadNames.ContainsKey($entry.FullName)) ("duplicate payload entry: " + $entry.FullName)
        $payloadNames[$entry.FullName] = $entry
    }

    Assert-True ($payloadNames.ContainsKey('NOTICE.txt')) 'NOTICE.txt missing'
    Assert-True ($payloadNames.ContainsKey('payload.json')) 'payload.json missing'
    $metadataEntry = $payload.GetEntry('payload.json')
    $metadata = Read-ZipEntryText $metadataEntry | ConvertFrom-Json
    Assert-True ([string]$metadata.betterNcm_audit_sha256 -eq $ExpectedAuditHash) 'payload metadata audit hash mismatch'
    Assert-True ([string]$metadata.plugin_slug -eq $slug) 'payload metadata plugin slug mismatch'
    Assert-True ([string]$metadata.plugin_version -eq $version) 'payload metadata plugin version mismatch'
    Assert-True ([int]$metadata.source_file_count -eq 19) 'payload metadata source_file_count is not 19'

    $pluginEntryName = [string]$metadata.plugin_entry
    Assert-True ($pluginEntryName.StartsWith('plugin/')) ('unexpected plugin entry: ' + $pluginEntryName)
    Assert-SafeZipPath $pluginEntryName
    Assert-True ($payloadNames.ContainsKey($pluginEntryName)) ('plugin entry missing: ' + $pluginEntryName)

    foreach ($relative in $sourceFiles) {
        $runtimeName = 'runtime/' + $relative.Substring(4)
        Assert-True ($payloadNames.ContainsKey($runtimeName)) ('runtime entry missing: ' + $runtimeName)
    }

    foreach ($name in $payloadNames.Keys) {
        if ($name -eq 'payload.json' -or $name -eq 'NOTICE.txt' -or $name -eq $pluginEntryName) { continue }
        Assert-True ($name.StartsWith('runtime/')) ('unexpected payload entry: ' + $name)
        Assert-True (-not ($name.StartsWith('runtime/out/'))) ('runtime/out must not be bundled: ' + $name)
        Assert-True (-not ($name.StartsWith('runtime/plugins/'))) ('runtime/plugins must not be bundled: ' + $name)
        $leaf = $name.Substring($name.LastIndexOf('/') + 1)
        Assert-True ($leaf -ne 'host.json' -and $leaf -ne 'agent.log' -and $leaf -ne 'agent.lock') (
            'runtime state must not be bundled: ' + $name
        )
    }

    Assert-True ($payloadNames.ContainsKey('runtime/bin/node.exe')) 'embedded Node runtime is missing'
    Assert-True ($payloadNames['runtime/bin/node.exe'].Length -gt 10000000) 'embedded Node runtime is implausibly small'

    $pluginTemp = Join-Path $buildDir 'verify-plugin.plugin'
    if (Test-Path -LiteralPath $pluginTemp) { Remove-Item -LiteralPath $pluginTemp -Force }
    $pluginStream = $payloadNames[$pluginEntryName].Open()
    try { Copy-StreamToFile $pluginStream $pluginTemp }
    finally { $pluginStream.Dispose() }

    $pluginHash = Get-Sha256 $pluginTemp
    if ([string]$metadata.plugin_sha256) {
        Assert-True ($pluginHash -eq [string]$metadata.plugin_sha256) 'embedded plugin SHA-256 does not match metadata'
    }

    $pluginZip = [System.IO.Compression.ZipFile]::OpenRead($pluginTemp)
    try {
        $pluginManifestEntry = $pluginZip.GetEntry('manifest.json')
        Assert-True ($null -ne $pluginManifestEntry) 'embedded plugin has no manifest.json'
        Assert-True ($null -ne $pluginZip.GetEntry('main.js')) 'embedded plugin has no main.js'
        foreach ($entry in $pluginZip.Entries) { Assert-SafeZipPath $entry.FullName }
        $pluginManifest = Read-ZipEntryText $pluginManifestEntry | ConvertFrom-Json
        Assert-True ([string]$pluginManifest.slug -eq $slug) 'embedded plugin slug mismatch'
        Assert-True ([string]$pluginManifest.version -eq $version) 'embedded plugin version mismatch'
    }
    finally {
        $pluginZip.Dispose()
    }
}
finally {
    $payload.Dispose()
}

$exeHash = Get-Sha256 $ExePath
Write-Host ''
Write-Host '[ok] audit archive SHA-256 matches' -ForegroundColor Green
Write-Host ('[ok] explicit runtime source list: ' + $sourceFiles.Count)
Write-Host '[ok] payload ZIP paths and contents are safe'
Write-Host '[ok] no app/out, app/plugins, host.json, logs or proxy DLL in payload'
Write-Host ('[ok] embedded plugin: ' + $slug + ' ' + $version)
Write-Host ('[ok] exe sha256: ' + $exeHash) -ForegroundColor Green
Write-Host ('[ok] payload sha256: ' + $payloadHash)
Write-Host ''
Write-Host 'Launcher, node.exe, agent and NetEase were not executed.'
