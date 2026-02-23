# ShieldBinary — Launch full stack locally (Windows)
# Starts: Redis (Docker, optional) | API | Worker | Frontend
# Usage: .\scripts\run.ps1     — run everything
#        .\scripts\run.ps1 -NoRedis  — skip Redis check (use existing instance)

param([switch]$NoRedis)

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
    $redisRunning = docker ps -q -f "name=redis" 2>$null
    if (-not $redisRunning) {
        Write-Host "[Redis] Starting Redis in Docker..." -ForegroundColor Gray
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "docker run --rm -p 6379:6379 --name shieldbinary-redis redis:7-alpine" -WindowStyle Minimized
        Start-Sleep -Seconds 2
        Write-Host "[Redis] Running on localhost:6379" -ForegroundColor Green
    }
    else { Write-Host "[Redis] Using existing container" -ForegroundColor Green }
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

# --- Start services ---
Write-Host '[API] Starting on http://localhost:8080...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; go run ./cmd/api" -WindowStyle Normal

Start-Sleep -Seconds 2

Write-Host '[Worker] Starting...' -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; go run ./cmd/worker" -WindowStyle Normal

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
