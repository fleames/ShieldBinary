# ShieldBinary

Binary protection SaaS — harden, obfuscate, and encrypt Windows executables (.exe, .dll) for native PE and .NET assemblies.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│   Frontend   │────▶│  API (Go)     │────▶│   Redis Job Queue    │
│  (React SPA) │     │  :8080        │     └──────────┬───────────┘
└──────────────┘     └──────────────┘                │
                                                      ▼
                                          ┌───────────────────────┐
                                          │   Worker (Go)          │
                                          │   .NET engine or       │
                                          │   native packer        │
                                          └───────────────────────┘
```

## Quick start

### Prerequisites

| Tool   | Purpose                    |
|--------|----------------------------|
| Go 1.22+ | API, worker               |
| .NET 8 SDK | Protection engine       |
| Node 20+ | Frontend build/dev       |
| Redis  | Job queue (or Docker)      |
| Docker | Optional: Redis + full stack |

### Launch (pick one)

**1. One-command local (recommended)** — Builds engine/loader if needed, starts Redis (Docker), API, worker, frontend:

```powershell
# Windows
.\scripts\run.ps1
```

```bash
# Linux / macOS
./scripts/run.sh
```

Opens: **Dashboard** http://localhost:3000 · **API** http://localhost:8080 · **API Docs** http://localhost:8080/api/v1/docs

**2. Docker only** — API + worker + Redis + built frontend (no native PE packing):

```bash
docker compose up --build
# Dashboard & API: http://localhost:8080
```

**3. Manual** — Run each service in a separate terminal:

```bash
# T1: Redis
docker run -p 6379:6379 redis:7-alpine

# T2: API
go run ./cmd/api

# T3: Worker
go run ./cmd/worker

# T4: Frontend
cd web && npm install && npm run dev
```

### Config

```bash
cp config/config.yaml.example config/config.yaml
# Edit or use SHIELD_* env vars (see .env.example)
```

**Auth:** Set `SHIELD_JWT_SECRET` for registration/login. Omit for dev mode (built-in user). User data: SQLite (`database_path`).

**Rate limiting:** 20 jobs/hour, 10 auth attempts/15 min per IP. Set to 0 to disable.

**Storage:** Local `./storage/` when S3 not configured. Worker auto-detects .NET vs native PE. Engine: `bin/engine/`; loader: `bin/loader.exe` (Windows).

### Command-line protection (single file)

Use `shieldbinary-protect` to protect a file directly (no API/worker needed). Auto-detects .NET vs native PE:

```bash
go build -o bin/protect.exe ./cmd/protect
bin/protect.exe input.exe output.exe basic
```

Requires the engine (`bin/engine/`) for .NET and loader (`bin/loader.exe`) for native PE.

### Build native loader (Windows only, for native PE packing)

```bash
go build -ldflags "-s -w" -o bin/loader.exe ./cmd/loader
```

Place `loader.exe` in `bin/` or set `SHIELD_NATIVE_LOADER_PATH`. Native packing runs only on Windows.

### Build .NET engine

```bash
cd engine
dotnet publish -c Release -r win-x64 --self-contained -o ../bin/engine
# For Linux (Hetzner):
dotnet publish -c Release -r linux-x64 --self-contained -o ../bin/engine
```

Set `SHIELD_ENGINE_PATH` to the engine executable path.

### .NET publish hardening profiles (R2R / Single-file / Trimming / NativeAOT)

Use the profile script to produce deployment variants for compatibility/perf/hardening evaluation:

```powershell
# Windows
.\scripts\publish-dotnet-profiles.ps1 -Project .\testdata\dotnet-fixture\TestApp.csproj -Runtime win-x64 -OutputDir .\bin\publish-profiles
```

```bash
# Linux/macOS
./scripts/publish-dotnet-profiles.sh ./testdata/dotnet-fixture/TestApp.csproj linux-x64 Release ./bin/publish-profiles
```

Profiles produced:
- `baseline`
- `r2r` (`PublishReadyToRun=true`)
- `singlefile` (`PublishSingleFile=true`)
- `trimmed` (`PublishTrimmed=true`)
- `singlefile-r2r-trimmed` (combined)
- `nativeaot` (best-effort; may be skipped for incompatible apps)

Smoke validation (optional, slower):
```bash
SHIELD_RUN_PUBLISH_PROFILE_TESTS=1 go test -v ./internal/integration -run TestDotNetPublishProfiles_Smoke -count=1
```

### Assembly merging (ILRepack)

You can merge managed assemblies into a single merged DLL as a packaging hardening step:

```powershell
.\scripts\merge-assemblies.ps1 -Output .\bin\merged\app.merged.dll -Input .\bin\publish\App.dll,.\bin\publish\Dep.dll
```

```bash
./scripts/merge-assemblies.sh ./bin/merged/app.merged.dll ./bin/publish/App.dll ./bin/publish/Dep.dll
```

Notes:
- Uses local `dotnet` tool manifest and installs `dotnet-ilrepack` automatically if missing.
- Merge is most reliable for managed dependencies with compatible target frameworks.

### .NET apps: "application to execute does not exist"

Framework-dependent .NET apps (e.g. `MyApp.exe` + `MyApp.dll`) need all files together. The native packer protects the exe; the loader extracts and runs it from the **same folder as the loader**. So:

1. **Put the protected exe in the original app folder** (where `MyApp.dll`, `MyApp.runtimeconfig.json`, `MyApp.deps.json` exist).
2. Run the protected exe from that folder — the loader will run the app there so it can find its .dll.

**Alternative (more reliable):** Protect the .dll instead of the exe. The exe is just a launcher.
```bash
cd path\to\MyApp
bin\protect.exe MyApp.dll protected.dll minimal
# Copy protected.dll into the folder, rename to MyApp.dll (replace original)
# Run the original MyApp.exe — it will load your protected MyApp.dll
```

### Verify executables work after protection

Integration tests ensure protected binaries still run correctly:

```bash
# Using Make
make build-engine          # or: make build-engine RID=linux-x64
make build-loader          # Windows only, for native test
make test-integration

# Or manually
dotnet publish engine/ -c Release -r win-x64 --self-contained -o bin/engine
go build -ldflags "-s -w" -o bin/loader.exe ./cmd/loader   # Windows, for native test
go test -v ./internal/integration/
```

Tests build a minimal .NET fixture, protect it with the engine, run the protected output, and verify stdout and exit code. Pro and Enterprise tiers are also tested. Native pack execution is tested on Windows only (requires built loader).

**Note:** Protected .NET assemblies are framework-dependent by default. To run `protected.dll`, place a `protected.runtimeconfig.json` next to it (copy from your original app's `*.runtimeconfig.json` and rename), or use `dotnet protected.dll` with .NET SDK installed.

### Debugging protection issues

When a protected program crashes or behaves incorrectly:

```powershell
# Verbose mode: see each pass as it runs, full stack trace on failure
$env:SHIELD_ENGINE_VERBOSE = "1"
bin/protect.exe myapp.dll out.dll basic
# Or: bin/protect.exe myapp.dll out.dll basic -v

# Isolate which pass causes the crash: run only specific passes
$env:SHIELD_ENGINE_PASSES = "symbol_stripping"
bin/protect.exe myapp.dll out.dll basic

# Skip name/string obfuscation (max compatibility, works on any tier)
$env:SHIELD_ENGINE_SAFE = "1"
bin/protect.exe myapp.dll out.dll basic
```

Pass names: `symbol_stripping`, `anti_ildasm`, `name_obfuscation`, `string_encryption`, `resource_encryption`, `reference_proxy`, `delegate_proxy`, `reflection_dispatch`, `type_scramble`, `assembly_embed`, `anti_decompiler`, `invalid_metadata`, `method_body_encryption`, `dynamic_method_generation`, `constant_encoding`, `il_mutation`, `opaque_predicates`, `anti_debug`, `anti_tamper`, `control_flow_flattening`, `dead_code_insertion`, `virtualization`, `metadata_cleanup`.

Advanced opt-in passes (off by default):
- `resource_encryption` (set `SHIELD_ENGINE_RESOURCE_ENCRYPT=1`)
- `reference_proxy` (set `SHIELD_ENGINE_REFERENCE_PROXY=1`)
- `delegate_proxy` (set `SHIELD_ENGINE_DELEGATE_PROXY=1`)
- `reflection_dispatch` (set `SHIELD_ENGINE_REFLECTION_DISPATCH=1`)
- `il_mutation` (set `SHIELD_ENGINE_IL_MUTATION=1`)
- `type_scramble` (set `SHIELD_ENGINE_TYPE_SCRAMBLE=1`)
- `assembly_embed` (set `SHIELD_ENGINE_ASSEMBLY_EMBED=1`)
- `anti_decompiler` (set `SHIELD_ENGINE_ANTI_DECOMPILER=1`)
- `invalid_metadata` (set `SHIELD_ENGINE_INVALID_METADATA=1`)
- `method_body_encryption` (set `SHIELD_ENGINE_METHOD_BODY_ENCRYPT=1`)
- `dynamic_method_generation` (set `SHIELD_ENGINE_DYNAMIC_METHOD_GEN=1`)
- `runtime_rasp` (set `SHIELD_ENGINE_RASP=1` for runtime anti-debug/sandbox and method-integrity checks)
- `local_var_promotion` (set `SHIELD_ENGINE_LOCAL_VAR_PROMOTION=1` to rewrite selected locals into heap-backed state bag)
- `polymorphic_mode` (set `SHIELD_ENGINE_POLYMORPHIC=1` for higher-variance mutation templates per build)
- aggressive anti-decompiler mode: `SHIELD_ENGINE_ANTI_DECOMPILER_AGGRESSIVE=1` (use only with compatibility testing)

Name obfuscation rename modes:
- `SHIELD_ENGINE_RENAME_MODE=random|sequential|unicode|unprintable`
- `SHIELD_ENGINE_RENAME_UNSAFE=1` is required for `unprintable` mode.

## Project layout

| Path | Description |
|------|--------------|
| `cmd/api` | Go HTTP API server |
| `cmd/loader` | Native PE loader stub (Windows) |
| `cmd/protect` | CLI to protect a single file (.NET or native) |
| `cmd/worker` | Go job processor (calls .NET engine or native packer) |
| `internal/api` | Handlers, auth, routes |
| `internal/config` | Configuration loading |
| `internal/queue` | Redis job queue |
| `internal/storage` | Local + S3 storage |
| `internal/worker` | Worker logic |
| `engine/` | .NET protection pipeline (dnlib) |
| `web/` | React dashboard |
| `config/` | YAML config template |

## Protection tiers

- **Minimal** — Symbol stripping + metadata cleanup. No obfuscation. Use when other tiers crash.
- **Basic** — .NET: symbol stripping, string encryption, IL virtualization, metadata cleanup. Native: AES-GCM+compression packing (authenticated).
- **Pro** — Basic + anti-ILDASM, constant encoding, opaque predicates (.NET); + padding (native). (Virtualization already in Basic.)
- **Enterprise** — Pro + name obfuscation, control-flow flattening, anti-debug, anti-tamper, **IL virtualization** (.NET); + padded native payload hardening.

### IL virtualization (Themida/VMProtect-style)

Enterprise tier includes **code virtualization** by default: method IL is compiled to custom VM bytecode and executed by an interpreter at runtime. Original logic is hidden in virtualized form.

- **Toggle:** Set `engine_virtualization: false` in `config/config.yaml` or `SHIELD_ENGINE_VIRTUALIZATION=0` to disable (applies to Basic and Enterprise).
- **Requirement:** Deploy `ShieldBinary.VmRuntime.dll` alongside your protected assembly (same directory or probing path).
- **Scope:** Applies to ~40% of eligible methods (no exception handlers, no byrefs). Entry point, constructors, and abstract/P/Invoke methods are skipped.

### Lower output entropy

High-entropy binaries can trigger AV heuristics. Set `engine_low_entropy: true` or `SHIELD_ENGINE_LOW_ENTROPY=1` to use deterministic encoding: deterministic per-string/per-constant derivation and stable helper-type names. Protection remains effective; output entropy is reduced.

Polymorphic mode (`SHIELD_ENGINE_POLYMORPHIC=1`) is the opposite tuning: it increases build-to-build variation by using higher-variance IL mutation/dead-code/predicate templates. It is automatically suppressed when low entropy mode is enabled.

### Observability and smart retry

Job responses now include optional reporting fields:
- `pass_metrics`: per-pass duration/success/error with rough size delta
- `size_impact`: input/output bytes and per-pass deltas
- `compatibility_report`: container launch check report (`compatible`/`warning`/`incompatible`)
- `strength_score`: heuristic score (`0-100`), qualitative band, and analyst-time estimate
- `retry_suggestions`: ranked fallback configurations for failed or incompatible jobs

Worker compatibility check flags:
- `SHIELD_ENABLE_COMPAT_CHECK=1|0`
- `SHIELD_COMPAT_CHECK_MODE=container|windows_vm`
- `SHIELD_COMPAT_CHECK_TIMEOUT_SEC=12`
- `SHIELD_COMPAT_OUTPUT_MAX_BYTES=1200`
- `SHIELD_VM_RUNNER_URL=https://your-runner.example`
- `SHIELD_VM_RUNNER_AUTH_TOKEN=<token>`
- `SHIELD_VM_RUNNER_TIMEOUT_SEC=45`
- `SHIELD_VM_RUNNER_MAX_PAYLOAD_BYTES=125829120`

Notes:
- Compatibility checks are best-effort and do not block successful output upload.
- `windows_vm` mode sends both native and .NET outputs to a remote Windows VM runner (`POST /compat-check` JSON contract) for isolated launch checks.
- Full deployment walkthrough: `docs/windows-vm-runner-setup.md`
- Strength score is a heuristic estimate and should be treated as directional guidance, not proof.

### Optional malware scan via Windows Defender VM

The `/api/v1/scan` endpoint can optionally call a host-side Hyper-V scanner service that runs Windows Defender in a disposable guest and restores snapshot state for every scan.

Config:
- `SHIELD_ENABLE_VM_SCAN=1`
- `SHIELD_VM_SCAN_MODE=windows_vm_defender`
- `SHIELD_VM_SCAN_URL=http://<host>:9091`
- `SHIELD_VM_SCAN_AUTH_TOKEN=<token>`
- `SHIELD_VM_SCAN_TIMEOUT_SEC=90`
- `SHIELD_VM_SCAN_MAX_PAYLOAD_BYTES=125829120`

When enabled, scan response includes an `av_report` block (provider/verdict/threat names/notes).

Setup guide: `docs/windows-vm-av-scanner-setup.md`

### Threat intelligence feedback loop (manual opt-in)

ShieldBinary now supports a manual opt-in threat intelligence flow (VirusTotal first integration):
- Submit a completed protected output using `POST /api/v1/jobs/:id/threat-intel/submit`
- Check submission/result status via `GET /api/v1/jobs/:id/threat-intel`
- Review technique-level flags via `GET /api/v1/threat-intel/flags`

When enabled, the worker polls pending provider analyses and computes rolling technique detection signals. Techniques can be flagged for review when detection reliability rises beyond configured heuristics.

Configuration:
- `SHIELD_ENABLE_THREAT_INTEL=1`
- `SHIELD_THREAT_INTEL_PROVIDER=virustotal`
- `SHIELD_VT_API_KEY=<key>`
- `SHIELD_THREAT_INTEL_POLL_INTERVAL_SEC=30`
- `SHIELD_THREAT_INTEL_LOOKUP_TIMEOUT_SEC=20`
- `SHIELD_THREAT_INTEL_MAX_SAMPLE_BYTES=31457280`
- `SHIELD_VT_BASE_URL=https://www.virustotal.com/api/v3`
- `SHIELD_VT_MAX_RETRIES=2`

Safety defaults:
- Off by default (`enable_threat_intel=false`)
- Manual opt-in only (no automatic uploads)
- Max sample size guard enforced before submission

### Pro tier stability

If **Pro** crashes on your app (e.g. reflection-heavy, game tools):

1. **Use safe Pro mode** — runs Pro with only Basic + AntiILDASMPass:
   ```powershell
   $env:SHIELD_ENGINE_SAFE_PRO = "1"
   # Then run protect or start worker with this env set
   ```
   For the worker (API flow), set `engine_safe_pro: true` in `config/config.yaml` or `SHIELD_ENGINE_SAFE_PRO=1` in the worker's environment.

2. **Isolate the failing pass** — run specific passes to find the culprit:
   ```powershell
   $env:SHIELD_ENGINE_PASSES = "symbol_stripping,anti_ildasm,string_encryption,constant_encoding"
   bin/protect.exe myapp.dll out.dll pro
   ```
   Add/remove passes until you identify which one causes the crash.

3. **Fall back to Basic** — if Pro remains unstable, Basic is the most compatible tier.

**Other env vars:** `SHIELD_ENGINE_SAFE=1` skips name obfuscation and string encryption (any tier). `SHIELD_ENGINE_VERBOSE=1` logs each pass. `SHIELD_ENGINE_LOW_ENTROPY=1` uses deterministic encoding to reduce output entropy (helps avoid AV heuristic triggers).

## Hetzner deployment

1. Provision a VPS (Ubuntu 22.04)
2. Install Docker + Docker Compose
3. Configure Hetzner Object Storage (S3-compatible) for binaries
4. Set `SHIELD_*` env vars (Redis, storage, JWT secret)
5. `docker compose up -d`

**Note:** Linux Docker deployment only supports .NET protection. Native PE packing needs a Windows worker (e.g. a separate Windows VM running the worker).

### Health checks

- `GET /health` — Liveness (always 200 if server is up)
- `GET /ready` — Readiness (200 if Redis is reachable; 503 otherwise)

## License

Proprietary — see LICENSE.
