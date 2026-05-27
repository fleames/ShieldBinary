# ShieldBinary — Launch full stack locally (Windows)
# Starts: Redis (Docker, optional) | API | Worker | Frontend
# Usage: .\scripts\run.ps1                              — run everything
#        .\scripts\run.ps1 -NoRedis                     — skip Redis check (use existing instance)
#        .\scripts\run.ps1 -EnableThreatIntel           — enable manual opt-in threat intel flow
#        .\scripts\run.ps1 -EnableThreatIntel -VTApiKey "<key>"   — enable VT integration for API/worker
#        .\scripts\run.ps1 -EnableThreatIntel -ThreatIntelMaxSampleMB 100   — allow larger TI submissions

param(
    [switch]$NoRedis,
    [switch]$EnableThreatIntel,
    [string]$VTApiKey = "",
    [int]$ThreatIntelMaxSampleMB = 30
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-Command { param($name) $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

# --- Prerequisites ---
if (-not (Test-Command go)) {
    Write-Host "Go not found. Try Docker instead: docker compose up --build" -ForegroundColor Yellow
    if (Test-Command docker) {
        docker compose up --build
        exit 0
    }
    Write-Host "Error: Need Go (https://go.dev/dl) or Docker." -ForegroundColor Red
    exit 1
}

Write-Host 'ShieldBinary - Starting local stack' -ForegroundColor Cyan
Write-Host ''

# --- Redis (optional) ---
if (-not $NoRedis -and (Test-Command docker)) {
    $redisName = "shieldbinary-redis"
    $redisVolume = "shieldbinary-redis-data"
    $redisRunning = docker ps -q -f "name=^/$redisName$" 2>$null
    if ($redisRunning) {
        Write-Host "[Redis] Using existing running container ($redisName)" -ForegroundColor Green
    } else {
        $redisExists = docker ps -aq -f "name=^/$redisName$" 2>$null
        if ($redisExists) {
            Write-Host "[Redis] Starting existing container ($redisName)..." -ForegroundColor Gray
            docker start $redisName | Out-Null
            Start-Sleep -Seconds 1
            Write-Host "[Redis] Running on localhost:6379" -ForegroundColor Green
        } else {
            Write-Host "[Redis] Creating persistent container ($redisName)..." -ForegroundColor Gray
            docker run -d -p 6379:6379 --name $redisName -v "${redisVolume}:/data" redis:7-alpine --appendonly yes | Out-Null
            Start-Sleep -Seconds 2
            Write-Host "[Redis] Running on localhost:6379 (volume: $redisVolume)" -ForegroundColor Green
        }
    }
} elseif (-not $NoRedis) {
    Write-Host "[Redis] Docker not found. Ensure Redis is running: docker run -p 6379:6379 redis:7-alpine" -ForegroundColor Yellow
} else {
    Write-Host "[Redis] Skipped (using existing Redis)" -ForegroundColor Gray
}

# --- Engine ---
$enginePaths = @(
    "bin/engine/shieldbinary-engine.exe",
    "bin/engine/shieldbinary-engine",
    "engine/bin/Release/net8.0/win-x64/shieldbinary-engine.dll",
    "engine/bin/Debug/net8.0/win-x64/shieldbinary-engine.dll"
)
$hasEngine = $enginePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $hasEngine) {
    Write-Host "[Engine] Building .NET engine..." -ForegroundColor Gray
    dotnet publish engine/ShieldBinary.Engine.csproj -c Release -r win-x64 --self-contained -o bin/engine | Out-Null
    Write-Host "[Engine] Built at bin/engine/" -ForegroundColor Green
} else { Write-Host "[Engine] Found" -ForegroundColor Green }

# --- Loader (native PE, Windows only) ---
Write-Host "[Loader] Building native loader (-s -w strips .symtab/.zdebug)..." -ForegroundColor Gray
go build -ldflags "-s -w" -o bin/loader.exe ./cmd/loader 2>$null
if (Test-Path "bin/loader.exe") { Write-Host "[Loader] Built" -ForegroundColor Green }
else { Write-Host "[Loader] Skipped (native PE packing optional)" -ForegroundColor Gray }

# --- Scanner (in-house executable scanner) ---
go build -o bin/scanner.exe ./cmd/scanner 2>$null
if (Test-Path "bin/scanner.exe") { Write-Host "[Scanner] Built (bin/scanner.exe)" -ForegroundColor Green }

Write-Host ''

# --- Threat intel env wiring ---
$threatIntelPrefix = ""
if ($EnableThreatIntel) {
    $threatIntelPrefix = "`$env:SHIELD_ENABLE_THREAT_INTEL='1'; `$env:SHIELD_THREAT_INTEL_PROVIDER='virustotal'; "
    if ($ThreatIntelMaxSampleMB -gt 0) {
        $maxBytes = $ThreatIntelMaxSampleMB * 1024 * 1024
        $threatIntelPrefix += "`$env:SHIELD_THREAT_INTEL_MAX_SAMPLE_BYTES='$maxBytes'; "
        Write-Host "[Threat Intel] Max sample size: ${ThreatIntelMaxSampleMB}MB" -ForegroundColor Gray
    }
    if ($VTApiKey -ne "") {
        $escaped = $VTApiKey.Replace("'", "''")
        $threatIntelPrefix += "`$env:SHIELD_VT_API_KEY='$escaped'; "
    } else {
        Write-Host '[Threat Intel] Enabled without VT API key (submit calls will fail until key is provided)' -ForegroundColor Yellow
    }
    Write-Host '[Threat Intel] Enabled (manual opt-in mode)' -ForegroundColor Green
} else {
    Write-Host '[Threat Intel] Disabled' -ForegroundColor Gray
}

# --- Start services ---
Write-Host ''
# --- Start services ---
Write-Host '[API] Starting on http://localhost:8080...' -ForegroundColor Cyan
$apiCommand = $threatIntelPrefix + "cd '$root'; go run ./cmd/api"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $apiCommand -WindowStyle Normal

Start-Sleep -Seconds 2

Write-Host '[Worker] Starting...' -ForegroundColor Cyan
$workerCommand = $threatIntelPrefix + "cd '$root'; go run ./cmd/worker"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $workerCommand -WindowStyle Normal

Start-Sleep -Seconds 1

Write-Host '[Frontend] Starting on http://localhost:3000...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\web'; npm run dev" -WindowStyle Normal

Write-Host ''
Write-Host 'ShieldBinary is running:' -ForegroundColor Green
Write-Host '  Dashboard: http://localhost:3000'
Write-Host '  API:       http://localhost:8080'
Write-Host '  API Docs:  http://localhost:8080/api/v1/docs'
Write-Host ''
Write-Host 'Close each window to stop, or run: docker stop shieldbinary-redis (if started)' -ForegroundColor Gray
