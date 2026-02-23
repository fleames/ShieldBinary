#!/bin/bash
# ShieldBinary — Launch full stack locally (Linux/macOS)
# Usage: ./scripts/run.sh        — run everything
#        ./scripts/run.sh --no-redis  — skip Redis (use existing)

set -e
cd "$(dirname "$0")/.."

NO_REDIS=false
for arg in "$@"; do
  [[ "$arg" == "--no-redis" ]] && NO_REDIS=true
done

cmd_exists() { command -v "$1" &>/dev/null; }

# --- Prerequisites ---
if ! cmd_exists go; then
  echo "Go not found. Try Docker: docker compose up --build"
  if cmd_exists docker; then
    docker compose up --build
    exit 0
  fi
  echo "Error: Need Go (https://go.dev/dl) or Docker."
  exit 1
fi

echo "ShieldBinary — Starting local stack"
echo ""

# --- Redis ---
if [[ "$NO_REDIS" == "false" ]] && cmd_exists docker; then
  if ! docker ps -q -f "name=shieldbinary-redis" 2>/dev/null | grep -q .; then
    echo "[Redis] Starting Redis in Docker..."
    docker run -d --rm -p 6379:6379 --name shieldbinary-redis redis:7-alpine 2>/dev/null || true
    sleep 2
    echo "[Redis] Running on localhost:6379"
  else
    echo "[Redis] Using existing container"
  fi
elif [[ "$NO_REDIS" == "false" ]]; then
  echo "[Redis] Ensure Redis is running: docker run -p 6379:6379 redis:7-alpine"
else
  echo "[Redis] Skipped"
fi

# --- Engine ---
if [[ ! -f bin/engine/shieldbinary-engine ]] && [[ ! -f bin/engine/shieldbinary-engine.exe ]] && \
   [[ ! -f engine/bin/Debug/net8.0/shieldbinary-engine.dll ]] && [[ ! -f engine/bin/Release/net8.0/shieldbinary-engine.dll ]]; then
  echo "[Engine] Building .NET engine..."
  if [[ "$(uname)" == "Darwin" ]]; then
    RID="$([[ $(uname -m) == "arm64" ]] && echo osx-arm64 || echo osx-x64)"
  else
    RID="linux-x64"
  fi
  dotnet publish engine/ShieldBinary.Engine.csproj -c Release -r "$RID" --self-contained -o bin/engine
  echo "[Engine] Built at bin/engine/"
else
  echo "[Engine] Found"
fi

echo ""

# --- Start API and Worker (background) ---
echo "[API] Starting on http://localhost:8080..."
go run ./cmd/api &
API_PID=$!

sleep 2
echo "[Worker] Starting..."
go run ./cmd/worker &
WORKER_PID=$!

trap "kill $API_PID $WORKER_PID 2>/dev/null; exit" EXIT INT TERM

echo ""
echo "[Frontend] Starting on http://localhost:3000... (Ctrl+C to stop)"
echo ""
echo "ShieldBinary is running:"
echo "  Dashboard: http://localhost:3000"
echo "  API:       http://localhost:8080"
echo "  API Docs:  http://localhost:8080/api/v1/docs"
echo ""
cd web && npm run dev
