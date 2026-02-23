# ShieldBinary — Build and run
# Prerequisites: Go 1.22+, .NET 8 SDK, Node 20+, Redis

.PHONY: build build-engine build-loader test test-integration run run-docker prereqs

build:
	go build ./...

# Build .NET engine. RID=win-x64|linux-x64|osx-arm64 (default: host)
build-engine:
	dotnet publish engine/ -c Release -r $(or $(RID),win-x64) --self-contained -o bin/engine

# Build native PE loader (Windows only, for native .exe packing)
build-loader:
	go build -ldflags "-s -w" -o bin/loader.exe ./cmd/loader

test:
	go test ./...

# Integration tests: build engine first; on Windows, build loader for native test
test-integration: build-engine
	go test -v ./internal/integration/ -count=1

# Run full stack locally
run:
	@echo "ShieldBinary — launch options:"; \
	echo "  Windows:  .\\scripts\\run.ps1"; \
	echo "  Unix:     ./scripts/run.sh"; \
	echo "  Docker:   make run-docker  (or: docker compose up --build)"

# Run with Docker (API + Worker + Redis; no native PE packing)
run-docker:
	docker compose up --build

# Check prerequisites
prereqs:
	@echo "Checking prerequisites..."; \
	command -v go >/dev/null 2>&1 && echo "  Go: OK" || echo "  Go: MISSING"; \
	command -v dotnet >/dev/null 2>&1 && echo "  .NET: OK" || echo "  .NET: MISSING"; \
	command -v node >/dev/null 2>&1 && echo "  Node: OK" || echo "  Node: MISSING"; \
	command -v docker >/dev/null 2>&1 && echo "  Docker: OK" || echo "  Docker: optional"; \
	nc -z localhost 6379 2>/dev/null && echo "  Redis: running" || echo "  Redis: not running (scripts will start via Docker)"
