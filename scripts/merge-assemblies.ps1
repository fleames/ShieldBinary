# ShieldBinary - merge managed assemblies with ILRepack
# Usage:
#   .\scripts\merge-assemblies.ps1 -Output .\bin\merged\App.merged.dll -Input .\bin\publish\MyApp.dll,.\bin\publish\Dep1.dll

param(
    [Parameter(Mandatory = $true)][string]$Output,
    [Parameter(Mandatory = $true)][string[]]$Input,
    [switch]$Internalize
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($Input.Count -lt 2) {
    throw "Provide at least two assemblies in -Input for merge."
}

foreach ($asm in $Input) {
    if (-not (Test-Path $asm)) {
        throw "Input assembly not found: $asm"
    }
}

$outDir = Split-Path -Parent $Output
if ($outDir -and -not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

# Ensure local tool manifest exists
if (-not (Test-Path ".config/dotnet-tools.json")) {
    dotnet new tool-manifest | Out-Null
}

# Ensure ILRepack tool exists in local manifest
$toolList = dotnet tool list --local
if ($toolList -notmatch "dotnet-ilrepack") {
    dotnet tool install dotnet-ilrepack --local | Out-Null
}

$args = @(
    "/out:$Output",
    "/targetplatform:v4"
)
if ($Internalize) {
    $args += "/internalize"
}
$args += $Input

Write-Host "[merge] ILRepack -> $Output" -ForegroundColor Cyan
dotnet tool run ilrepack -- @args
Write-Host "[merge] done" -ForegroundColor Green
