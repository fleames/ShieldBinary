# ShieldBinary - .NET publish profiles helper
# Produces optional hardening/runtime profiles for app deployment experiments.
# Usage:
#   .\scripts\publish-dotnet-profiles.ps1 -Project .\testdata\dotnet-fixture\TestApp.csproj -Runtime win-x64 -OutputDir .\bin\publish-profiles

param(
    [Parameter(Mandatory = $true)][string]$Project,
    [string]$Runtime = "win-x64",
    [string]$Configuration = "Release",
    [string]$OutputDir = "bin/publish-profiles"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path $Project)) {
    throw "Project not found: $Project"
}

function Publish-Profile {
    param(
        [string]$Name,
        [string[]]$Props
    )
    $out = Join-Path $OutputDir $Name
    New-Item -ItemType Directory -Path $out -Force | Out-Null
    $args = @(
        "publish", $Project,
        "-c", $Configuration,
        "-r", $Runtime,
        "--self-contained", "true",
        "-o", $out
    ) + $Props
    Write-Host "[publish] $Name -> $out" -ForegroundColor Cyan
    dotnet @args
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

# Baseline
Publish-Profile -Name "baseline" -Props @()

# ReadyToRun profile
Publish-Profile -Name "r2r" -Props @(
    "-p:PublishReadyToRun=true"
)

# Single-file profile
Publish-Profile -Name "singlefile" -Props @(
    "-p:PublishSingleFile=true",
    "-p:IncludeNativeLibrariesForSelfExtract=true"
)

# Trimmed profile (warnings visible for compatibility tuning)
Publish-Profile -Name "trimmed" -Props @(
    "-p:PublishTrimmed=true",
    "-p:TrimMode=partial"
)

# Composite profile: single-file + r2r + trim
Publish-Profile -Name "singlefile-r2r-trimmed" -Props @(
    "-p:PublishSingleFile=true",
    "-p:IncludeNativeLibrariesForSelfExtract=true",
    "-p:PublishReadyToRun=true",
    "-p:PublishTrimmed=true",
    "-p:TrimMode=partial"
)

# NativeAOT (best-effort; may fail for unsupported apps)
try {
    Publish-Profile -Name "nativeaot" -Props @(
        "-p:PublishAot=true",
        "-p:InvariantGlobalization=true"
    )
}
catch {
    Write-Host "[publish] nativeaot skipped: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Publish profiles completed under: $OutputDir" -ForegroundColor Green
