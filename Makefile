# ShieldBinary — Build and run
# Prerequisites: Go 1.22+, .NET 8 SDK, Node 20+, Redis

.PHONY: build build-engine build-loader publish-profiles publish-profiles-win publish-profiles-linux merge-assemblies merge-assemblies-win test test-integration run run-docker prereqs

build:
	go build ./...

# Build .NET engine. RID=win-x64|linux-x64|osx-arm64 (default: host)
build-engine:
	dotnet publish engine/ -c Release -r $(or $(RID),win-x64) --self-contained -o bin/engine

# Build native PE loader (Windows only, for native .exe packing)
build-loader:
	go build -ldflags "-s -w" -o bin/loader.exe ./cmd/loader

# Publish .NET deployment hardening profiles (baseline/r2r/single-file/trim/nativeaot best-effort)
# PROJECT defaults to test fixture; override with your app .csproj
publish-profiles:
	./scripts/publish-dotnet-profiles.sh $(or $(PROJECT),./testdata/dotnet-fixture/TestApp.csproj) $(or $(RID),linux-x64) Release ./bin/publish-profiles

publish-profiles-win:
	powershell -ExecutionPolicy Bypass -File .\scripts\publish-dotnet-profiles.ps1 -Project $(or $(PROJECT),.\testdata\dotnet-fixture\TestApp.csproj) -Runtime $(or $(RID),win-x64) -OutputDir .\bin\publish-profiles

publish-profiles-linux:
	./scripts/publish-dotnet-profiles.sh $(or $(PROJECT),./testdata/dotnet-fixture/TestApp.csproj) $(or $(RID),linux-x64) Release ./bin/publish-profiles

# Merge managed assemblies with ILRepack (requires local dotnet tool)
# OUTPUT defaults to ./bin/merged/app.merged.dll
# INPUTS must include at least two assemblies, e.g.:
# make merge-assemblies OUTPUT=./bin/merged/app.dll INPUTS="./bin/publish/App.dll ./bin/publish/Dep.dll"
merge-assemblies:
	./scripts/merge-assemblies.sh $(or $(OUTPUT),./bin/merged/app.merged.dll) $(INPUTS)

merge-assemblies-win:
	powershell -ExecutionPolicy Bypass -File .\scripts\merge-assemblies.ps1 -Output $(or $(OUTPUT),.\bin\merged\app.merged.dll) -Input $(INPUTS)

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
