# build.ps1 -- build the single-file Windows x64 launcher.
#
# Output:
#   packaging\dist\NCM-ListenTogether-Windows-x64.zip
#   packaging\dist\NCM-ListenTogether-x64.exe
#   packaging\dist\SHA256SUMS.txt
#   packaging\dist\BUILD-INFO.txt
#
# The EXE embeds packaging\.build\payload.zip as the managed resource "payload.zip".
# Every run verifies the audited BetterNCM archive SHA-256 before reading it, and
# only copies the 19 entries listed in SOURCE-FILES.txt (app/ only, no out/plugins).
#
# This script deliberately does not execute the produced EXE, the NetEase client,
# or any bundled helper. It only runs the repository's own build.cjs and csc.exe.

[CmdletBinding()]
param(
    [string]$OutDir = (Join-Path $PSScriptRoot 'dist'),
    [string]$AuditZip = (Join-Path $PSScriptRoot 'vendor\BetterNCM-v3-Portable-x64.zip'),
    [switch]$SkipPluginBuild
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

$Root          = Split-Path -Parent $PSScriptRoot
$ManifestPath  = Join-Path $Root 'manifest.json'
$SourceList    = Join-Path $PSScriptRoot 'SOURCE-FILES.txt'
$NoticeFile    = Join-Path $PSScriptRoot 'NOTICE.txt'
$LauncherCode  = Join-Path $PSScriptRoot 'src\Launcher.cs'
$BuildDir      = Join-Path $PSScriptRoot '.build'
$PayloadDir    = Join-Path $BuildDir 'payload'
$PayloadZip    = Join-Path $BuildDir 'payload.zip'
$Csc           = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$ExeName       = 'NCM-ListenTogether-x64.exe'
$ExePath       = Join-Path $OutDir $ExeName
$ZipName       = 'NCM-ListenTogether-Windows-x64.zip'
$ZipPath       = Join-Path $OutDir $ZipName

$ExpectedAuditHash = 'ecd2c17389efa1520cbd3426d0418eb4e5131d2aa66ef789c7d9557af5b066b7'
$BetterNcmRemote   = 'https://github.com/Leafmy/BetterNCM-v3'
$BetterNcmVersion  = 'v3.0.0'
$BetterNcmCommit   = '7ac5b54c59deb72448603c93caaad85f25139bfa'
$TargetNcmVersion  = '3.1.43.205627'

function Fail([string]$Message) { throw "ERROR: $Message" }

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { Fail $Message }
}

function Get-Sha256([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

# Reject absolute paths, drive letters, backslashes and any ".." component.
function Assert-SafeZipPath([string]$Name) {
    Assert-True ($null -ne $Name -and $Name.Length -gt 0) 'empty ZIP entry name'
    Assert-True (-not $Name.Contains('\')) ("ZIP entry uses a backslash: " + $Name)
    Assert-True (-not $Name.StartsWith('/')) ("ZIP entry is rooted: " + $Name)
    Assert-True (-not ($Name -match '^[A-Za-z]:')) ("ZIP entry has a drive letter: " + $Name)
    $trimmed = $Name.TrimEnd('/')
    foreach ($part in $trimmed.Split('/')) {
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

function Copy-ZipEntryToFile([System.IO.Compression.ZipArchiveEntry]$Entry, [string]$Destination) {
    $parent = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $inStream = $Entry.Open()
    $outStream = [System.IO.File]::Open($Destination, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $inStream.CopyTo($outStream, 131072)
        $outStream.Flush($true)
    }
    finally {
        $outStream.Dispose()
        $inStream.Dispose()
    }
}

function Add-FileToZip([System.IO.Compression.ZipArchive]$Archive, [string]$EntryName, [string]$SourcePath) {
    $entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $inStream = [System.IO.File]::OpenRead($SourcePath)
    $outStream = $entry.Open()
    try { $inStream.CopyTo($outStream, 131072) }
    finally {
        $outStream.Dispose()
        $inStream.Dispose()
    }
}

function Add-BytesToZip([System.IO.Compression.ZipArchive]$Archive, [string]$EntryName, [byte[]]$Bytes) {
    $entry = $Archive.CreateEntry($EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $outStream = $entry.Open()
    try { $outStream.Write($Bytes, 0, $Bytes.Length) } finally { $outStream.Dispose() }
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

# ---------------------------------------------------------------- inputs ----

Assert-True (Test-Path -LiteralPath $ManifestPath) ("manifest not found: " + $ManifestPath)
Assert-True (Test-Path -LiteralPath $AuditZip) ("BetterNCM archive not found: " + $AuditZip + '. See packaging/README.md.')
Assert-True (Test-Path -LiteralPath $SourceList) ("source list not found: " + $SourceList)
Assert-True (Test-Path -LiteralPath $NoticeFile) ("notice not found: " + $NoticeFile)
Assert-True (Test-Path -LiteralPath $LauncherCode) ("launcher source not found: " + $LauncherCode)
Assert-True (Test-Path -LiteralPath $Csc) ("csc.exe not found: " + $Csc)

$manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$slug = [string]$manifest.slug
$version = [string]$manifest.version
Assert-True ($slug.Length -gt 0) 'manifest.json has no slug'
Assert-True ($version.Length -gt 0) 'manifest.json has no version'

# ---------------------------------------------------- audit archive check ----

$auditHash = Get-Sha256 $AuditZip
Assert-True ($auditHash -eq $ExpectedAuditHash) (
    "BetterNCM audit SHA-256 mismatch.`n  expected: $ExpectedAuditHash`n  actual:   $auditHash"
)

$sourceFiles = @(
    Get-Content -LiteralPath $SourceList -Encoding UTF8 |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_.Length -gt 0 -and -not $_.StartsWith('#') }
)
Assert-True ($sourceFiles.Count -eq 19) ("SOURCE-FILES.txt must list exactly 19 files, found " + $sourceFiles.Count)
Assert-True (($sourceFiles | Sort-Object -Unique).Count -eq $sourceFiles.Count) 'SOURCE-FILES.txt contains duplicates'

$requiredSources = @(
    'app/LICENSE',
    'app/THIRD-PARTY-NOTICES.md',
    'app/bin/NODE-LICENSE.txt',
    'app/bin/node.exe',
    'app/tools/bncm_agent.mjs',
    'app/tools/ncm_host.mjs',
    'app/tools/bncm_preload.js',
    'app/loader/framework.js',
    'app/loader/hijacks.json',
    'app/loader/selectors.json'
)
foreach ($needed in $requiredSources) {
    Assert-True ($sourceFiles -contains $needed) ("SOURCE-FILES.txt is missing required entry: " + $needed)
}
foreach ($relative in $sourceFiles) {
    Assert-SafeZipPath $relative
    Assert-True ($relative.StartsWith('app/')) ("source is outside app/: " + $relative)
    Assert-True (-not ($relative.StartsWith('app/out/'))) ("proxy DLL must not be embedded: " + $relative)
    Assert-True (-not ($relative.StartsWith('app/plugins/'))) ("third-party plugins must not be embedded: " + $relative)
}

$audit = [System.IO.Compression.ZipFile]::OpenRead($AuditZip)
try {
    $auditEntries = @{}
    foreach ($entry in $audit.Entries) {
        Assert-SafeZipPath $entry.FullName
        if (-not $entry.FullName.EndsWith('/')) {
            Assert-True (-not $auditEntries.ContainsKey($entry.FullName)) ("duplicate ZIP entry: " + $entry.FullName)
            $auditEntries[$entry.FullName] = $entry
        }
    }

    foreach ($relative in $sourceFiles) {
        Assert-True ($auditEntries.ContainsKey($relative)) ("audit archive is missing: " + $relative)
        Assert-True ($auditEntries[$relative].Length -gt 0) ("audit archive entry is empty: " + $relative)
    }

    # Every app/ file must either be in the explicit list or be one of the two
    # excluded subtrees. This catches a new runtime file silently appearing.
    foreach ($name in $auditEntries.Keys) {
        if (-not $name.StartsWith('app/')) { continue }
        if ($sourceFiles -contains $name) { continue }
        if ($name.StartsWith('app/out/') -or $name.StartsWith('app/plugins/')) { continue }
        Fail ("unreviewed app/ file is not in SOURCE-FILES.txt: " + $name)
    }

    # ------------------------------------------------------- plugin build ----

    $pluginFileName = "ncm-listen-together-$version.plugin"
    $pluginPath = Join-Path $Root ("dist\" + $pluginFileName)

    if (-not $SkipPluginBuild) {
        $node = Get-Command node.exe -ErrorAction SilentlyContinue
        Assert-True ($null -ne $node) 'node.exe not found on PATH; install Node.js or use -SkipPluginBuild with an existing dist plugin'

        $null = & $node.Source '-e' "try{require.resolve(process.env.NCM_ESBUILD_PATH || 'esbuild');process.exit(0)}catch(e){console.error(e.message);process.exit(3)}"
        if ($LASTEXITCODE -ne 0) {
            Fail 'esbuild is not resolvable. Run npm install locally, set NCM_ESBUILD_PATH, or use -SkipPluginBuild with an existing dist plugin.'
        }
        if (-not $env:NCM_BUILD_PYTHON) {
            $python = Get-Command python.exe -ErrorAction SilentlyContinue
            Assert-True ($null -ne $python) 'python.exe not found; the existing build.cjs needs Python, or set NCM_BUILD_PYTHON'
        }

        Write-Host ("[build] compiling plugin from current src/ and manifest.json (version " + $version + ")")
        Push-Location $Root
        try {
            & $node.Source 'build.cjs'
            if ($LASTEXITCODE -ne 0) { Fail ("node build.cjs exited with code " + $LASTEXITCODE) }
        }
        finally {
            Pop-Location
        }
    }
    else {
        Write-Host '[build] -SkipPluginBuild: using the existing dist plugin'
    }

    Assert-True (Test-Path -LiteralPath $pluginPath) ("plugin build output not found: " + $pluginPath)

    $pluginZip = [System.IO.Compression.ZipFile]::OpenRead($pluginPath)
    try {
        $pluginManifestEntry = $pluginZip.GetEntry('manifest.json')
        $pluginMainEntry = $pluginZip.GetEntry('main.js')
        Assert-True ($null -ne $pluginManifestEntry) 'compiled plugin has no manifest.json'
        Assert-True ($null -ne $pluginMainEntry) 'compiled plugin has no main.js'
        foreach ($entry in $pluginZip.Entries) { Assert-SafeZipPath $entry.FullName }
        $pluginManifest = Read-ZipEntryText $pluginManifestEntry | ConvertFrom-Json
        Assert-True ([string]$pluginManifest.slug -eq $slug) (
            "compiled plugin slug mismatch: " + [string]$pluginManifest.slug + " != " + $slug
        )
        Assert-True ([string]$pluginManifest.version -eq $version) (
            "compiled plugin version mismatch: " + [string]$pluginManifest.version + " != " + $version
        )
    }
    finally {
        $pluginZip.Dispose()
    }
    $pluginHash = Get-Sha256 $pluginPath

    # ---------------------------------------------------------- payload ------

    if (Test-Path -LiteralPath $BuildDir) {
        $existingBuildDir = Get-Item -LiteralPath $BuildDir -Force
        $expectedBuildDir = Join-Path (Resolve-Path -LiteralPath $PSScriptRoot).Path '.build'
        Assert-True ($existingBuildDir.FullName -eq $expectedBuildDir -and
            -not ($existingBuildDir.Attributes -band [IO.FileAttributes]::ReparsePoint)) 'unsafe build directory'
        Remove-Item -LiteralPath $existingBuildDir.FullName -Recurse -Force
    }
    New-Item -ItemType Directory -Path (Join-Path $PayloadDir 'runtime') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $PayloadDir 'plugin') -Force | Out-Null

    foreach ($relative in $sourceFiles) {
        $destination = Join-Path $PayloadDir ('runtime\' + $relative.Substring(4).Replace('/', '\'))
        Copy-ZipEntryToFile $auditEntries[$relative] $destination
    }

    Copy-Item -LiteralPath $NoticeFile -Destination (Join-Path $PayloadDir 'NOTICE.txt') -Force
    Copy-Item -LiteralPath $pluginPath -Destination (Join-Path $PayloadDir ('plugin\' + $pluginFileName)) -Force

    $auditShort = $auditHash.Substring(0, 12)
    $payloadVersion = "betterncm-v3.0.0-$auditShort-plugin-$version"
    $metadata = [ordered]@{
        payload_version       = $payloadVersion
        launcher_version      = '1.0.0'
        betterNcm_project     = $BetterNcmRemote
        betterNcm_version     = $BetterNcmVersion
        betterNcm_commit      = $BetterNcmCommit
        betterNcm_audit_sha256 = $auditHash
        plugin_entry          = "plugin/$pluginFileName"
        plugin_file           = $pluginFileName
        plugin_slug           = $slug
        plugin_version        = $version
        plugin_sha256         = $pluginHash
        ncm_file_version      = $TargetNcmVersion
        source_file_count     = 19
    }
    $metadataJson = $metadata | ConvertTo-Json -Depth 4
    Write-Utf8NoBom (Join-Path $PayloadDir 'payload.json') ($metadataJson + [Environment]::NewLine)

    # Explicit payload entry list: metadata + notice + plugin + 19 runtime files.
    $runtimeFiles = @(
        Get-ChildItem -LiteralPath (Join-Path $PayloadDir 'runtime') -Recurse -File |
            Sort-Object FullName
    )
    Assert-True ($runtimeFiles.Count -eq 19) ("payload runtime file count is " + $runtimeFiles.Count + ", expected 19")

    $payloadNames = New-Object System.Collections.Generic.List[string]
    $payloadNames.Add('payload.json')
    $payloadNames.Add('NOTICE.txt')
    $payloadNames.Add("plugin/$pluginFileName")
    foreach ($file in $runtimeFiles) {
        $rel = $file.FullName.Substring($PayloadDir.Length + 1).Replace('\', '/')
        $payloadNames.Add($rel)
    }
    Assert-True (($payloadNames | Sort-Object -Unique).Count -eq $payloadNames.Count) 'payload entry list contains duplicates'

    if (Test-Path -LiteralPath $PayloadZip) { Remove-Item -LiteralPath $PayloadZip -Force }
    $payloadStream = [System.IO.File]::Open($PayloadZip, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $payloadArchive = New-Object System.IO.Compression.ZipArchive -ArgumentList @($payloadStream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
    try {
        Add-FileToZip $payloadArchive 'payload.json' (Join-Path $PayloadDir 'payload.json')
        Add-FileToZip $payloadArchive 'NOTICE.txt' (Join-Path $PayloadDir 'NOTICE.txt')
        Add-FileToZip $payloadArchive ("plugin/$pluginFileName") (Join-Path $PayloadDir ('plugin\' + $pluginFileName))
        foreach ($file in $runtimeFiles) {
            $rel = $file.FullName.Substring($PayloadDir.Length + 1).Replace('\', '/')
            Add-FileToZip $payloadArchive $rel $file.FullName
        }
    }
    finally {
        $payloadArchive.Dispose()
        $payloadStream.Dispose()
    }

    $payloadHash = Get-Sha256 $PayloadZip

    # ---------------------------------------------------------- compile ------

    if (-not (Test-Path -LiteralPath $OutDir)) {
        New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    }
    if (Test-Path -LiteralPath $ExePath) { Remove-Item -LiteralPath $ExePath -Force }

    Write-Host '[build] compiling WinForms launcher with Windows .NET Framework csc.exe (C# 5, x64)'
    $cscArgs = @(
        '/nologo',
        '/target:winexe',
        '/platform:x64',
        '/langversion:5',
        '/optimize+',
        '/debug-',
        '/codepage:65001',
        ('/out:' + $ExePath),
        '/reference:System.dll',
        '/reference:System.Core.dll',
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll',
        '/reference:System.IO.Compression.dll',
        ('/resource:' + $PayloadZip + ',payload.zip'),
        $LauncherCode
    )
    $cscOutput = & $Csc @cscArgs 2>&1
    if ($cscOutput) { $cscOutput | ForEach-Object { Write-Host $_ } }
    Assert-True ($LASTEXITCODE -eq 0) ("csc.exe failed with code " + $LASTEXITCODE)

    Assert-True (Test-Path -LiteralPath $ExePath) ("launcher was not produced: " + $ExePath)

    # Read the managed resource without executing the EXE's entry point.
    $assembly = Get-ResourceAssembly $ExePath
    $resourceNames = @($assembly.GetManifestResourceNames())
    Assert-True ($resourceNames -contains 'payload.zip') (
        "payload.zip is not embedded; resources: " + ($resourceNames -join ', ')
    )
    $resourceStream = $assembly.GetManifestResourceStream('payload.zip')
    try {
        Assert-True ($null -ne $resourceStream) 'embedded payload.zip stream is null'
        Assert-True ($resourceStream.Length -eq (Get-Item -LiteralPath $PayloadZip).Length) 'embedded payload length differs from staging payload'
    }
    finally {
        if ($null -ne $resourceStream) { $resourceStream.Dispose() }
    }

    $exeHash = Get-Sha256 $ExePath
    $zipTemp = $ZipPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $release = [IO.Compression.ZipFile]::Open($zipTemp, [IO.Compression.ZipArchiveMode]::Create)
    try { Add-FileToZip $release $ExeName $ExePath }
    finally { $release.Dispose() }
    if (Test-Path -LiteralPath $ZipPath) { [IO.File]::Replace($zipTemp, $ZipPath, [NullString]::Value) }
    else { [IO.File]::Move($zipTemp, $ZipPath) }
    $zipHash = Get-Sha256 $ZipPath

    # ---------------------------------------------------------- reports ------

    $sums = @($zipHash + '  ' + $ZipName; $exeHash + '  ' + $ExeName)
    Write-Utf8NoBom (Join-Path $OutDir 'SHA256SUMS.txt') (($sums -join [Environment]::NewLine) + [Environment]::NewLine)

    $buildInfo = @(
        'NCM-ListenTogether Windows x64 launcher',
        ("built_utc=" + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')),
        ("exe=" + $ExeName),
        ("exe_sha256=" + $exeHash),
        ("payload=" + $payloadVersion),
        ("payload_sha256=" + $payloadHash),
        ("plugin=" + $pluginFileName),
        ("plugin_slug=" + $slug),
        ("plugin_version=" + $version),
        ("plugin_sha256=" + $pluginHash),
        ("betterncm_project=" + $BetterNcmRemote),
        ("betterncm_version=" + $BetterNcmVersion),
        ("betterncm_commit=" + $BetterNcmCommit),
        ("betterncm_audit_sha256=" + $auditHash),
        ("ncm_file_version=" + $TargetNcmVersion),
        ("runtime_sources=" + $sourceFiles.Count),
        ("csc=" + $Csc)
    ) -join [Environment]::NewLine
    Write-Utf8NoBom (Join-Path $OutDir 'BUILD-INFO.txt') ($buildInfo + [Environment]::NewLine)

    Write-Host ''
    Write-Host '[ok] audit hash verified' -ForegroundColor Green
    Write-Host ('[ok] embedded runtime sources: ' + $sourceFiles.Count)
    Write-Host ('[ok] plugin: ' + $pluginFileName + ' (' + $pluginHash + ')')
    Write-Host ('[ok] payload: ' + $payloadVersion + ' (' + $payloadHash + ')')
    Write-Host ('[ok] exe: ' + $ExePath)
    Write-Host ('[ok] exe sha256: ' + $exeHash) -ForegroundColor Green
    Write-Host ('[ok] shareable zip: ' + $ZipPath)
}
finally {
    $audit.Dispose()
}
