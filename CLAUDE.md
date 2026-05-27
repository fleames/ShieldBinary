# ShieldBinary — Codebase Guide for Claude

## What this project is

**ShieldBinary** is a binary protection SaaS platform. Users upload Windows `.exe`/`.dll` files and get back hardened, obfuscated versions. It supports two binary paths:

- **.NET assemblies** — processed by a C# dnlib-based engine (`engine/`) with 20+ obfuscation passes
- **Native PE binaries** — AES-GCM packed by the Go native packer + loader stub (`cmd/loader`)

Brand name used in the UI: **ShieldBinary Nexus**.

## Stack

| Layer | Technology |
|---|---|
| API | Go 1.22, Gin, go-redis, Viper, Zap, JWT |
| Worker | Go 1.22 (same module) |
| Protection engine | .NET 8, C#, dnlib |
| VM runtime support | C# (`VmRuntime/`) |
| Frontend | React 18, TypeScript, Vite, react-router-dom v6 |
| Queue | Redis (BLPOP/LPUSH), job metadata in Redis hashes |
| Auth DB | SQLite via `modernc.org/sqlite` (no CGO needed) |
| Storage | Local filesystem OR S3-compatible (Hetzner Object Storage, MinIO) |
| Module path | `github.com/shieldbinary/backend` |

## Project layout

```
cmd/
  api/         Go API server entry point (:8080)
  worker/      Go job processor (dequeues from Redis, runs engine/packer)
  protect/     CLI: protect a single file without API
  loader/      Native PE loader stub (Windows only)
  scanner/     Scanner CLI
engine/
  Program.cs         Entry point — parses args/env, runs passes in sequence
  IProtectionPass.cs Pass interface
  Passes/            ~20 individual protection passes
  VM/                IL-to-VM compiler, opcodes, writer (Themida/VMProtect-style)
VmRuntime/           .NET runtime support for virtualized methods
internal/
  api/         Gin handlers, auth middleware, JWT, CORS, security headers
  auth/        User model, bcrypt password, SQLite store
  config/      Viper config (YAML + SHIELD_* env vars)
  nativepacker/ AES-GCM + compression packing for native PE
  peutil/      PE header parsing helpers
  queue/       Redis job queue + job payload struct + status helpers
  ratelimit/   Per-IP and per-user rate limiting (Redis-backed)
  scanner/     Binary scanner (PE info, AV report struct)
  storage/     Storage interface: local (`local.go`) and S3 (`s3.go`)
  threatintel/ VirusTotal client, SQLite store, analyzer, technique flagging
  worker/      Worker orchestration: compat check, VM runner, observability
web/
  src/
    App.tsx            Router + auth guard
    pages/
      Dashboard.tsx    Main upload/job flow (the core UI — 1100+ lines)
      Settings.tsx     Profile/settings page
      Scan.tsx         File scanner page
      Tiers.tsx        Tier comparison page
      Login.tsx        Auth
      Register.tsx     Auth
    components/
      Layout.tsx       App shell (header, nav, outlet)
    contexts/
      AuthContext.tsx  JWT token management, authFetch wrapper
    design-system/    Reusable UI primitives (Button, Card, Badge, Panel, etc.)
    lib/
      userSettings.ts  Local settings (tier default, preset, poll interval)
      api.ts           API error helpers
docs/                  Architecture/security docs (encryption-threat-model, obfuscation-matrix)
tools/
  vm-av-controller/   Python FastAPI — controls Hyper-V VM + Windows Defender scanning
  vm-host-controller/ Python FastAPI — Hyper-V compatibility check runner
config/
  config.yaml.example  Annotated config template
.env.example           All SHIELD_* env vars
```

## Protection tiers

| Tier | .NET passes | Native | Price |
|---|---|---|---|
| `minimal` | Symbol strip + metadata cleanup only | N/A | Free |
| `basic` | + string encryption, IL virtualization | AES-GCM + compression | $9 |
| `pro` | + anti-ILDASM, constant encoding, opaque predicates | + padding | $39 |
| `enterprise` | + name obfuscation, control-flow flattening, anti-debug, anti-tamper | + XOR layer | $149 |

## How to run locally (Windows)

```powershell
.\scripts\run.ps1
```

Opens: Dashboard http://localhost:3000 · API http://localhost:8080 · Docs http://localhost:8080/api/v1/docs

## Key API routes

```
POST /api/v1/auth/register   { email, password } -> { token, user }
POST /api/v1/auth/login      { email, password } -> { token, user }
GET  /api/v1/auth/me
POST /api/v1/upload           multipart file -> { input_key, filename, size }
POST /api/v1/scan             multipart file -> scan result
POST /api/v1/jobs             { input_key, tier, binary_type, low_entropy, polymorphic_mode, protections[] }
GET  /api/v1/jobs             -> { jobs[] }
GET  /api/v1/jobs/:id
DELETE /api/v1/jobs/:id
DELETE /api/v1/jobs
GET  /api/v1/jobs/:id/download    (single-download, deletes file after stream)
POST /api/v1/jobs/:id/threat-intel/submit
GET  /api/v1/jobs/:id/threat-intel
GET  /api/v1/threat-intel/flags
GET  /health
GET  /ready
GET  /api/v1/openapi.yaml
GET  /api/v1/docs             (Swagger UI)
```

## Configuration

All settings read from `config/config.yaml` and overridden by `SHIELD_*` env vars. Key ones:

```
SHIELD_JWT_SECRET        Required for production auth
SHIELD_REDIS_ADDR        default: localhost:6379
SHIELD_ENGINE_PATH       Path to shieldbinary-engine executable
SHIELD_WEB_ROOT          Path to built frontend dist/
SHIELD_STORAGE_ENDPOINT  S3 endpoint (Hetzner etc)
SHIELD_CORS_ORIGINS      Comma-separated allowed origins
SHIELD_ENVIRONMENT       "production" -> Gin release mode
```

## Build commands

```bash
# Go services
go build ./...

# .NET engine (Linux target for Docker)
dotnet publish engine/ -c Release -r linux-x64 --self-contained -o bin/engine

# Frontend
cd web && npm ci && npm run build

# Native loader (Windows only)
go build -ldflags "-s -w" -o bin/loader.exe ./cmd/loader

# Docker (full stack)
docker compose up --build
```

## Testing

```bash
go test ./...                           # unit tests
go test -v ./internal/integration/     # integration (requires built engine)
make test-integration                   # shortcut
```

## Deployment (Docker, Hetzner)

The `Dockerfile` is a multi-stage build: Go API+worker, .NET engine (linux-x64), frontend (node build), assembled into an `alpine:3.19` runtime image. Set `SHIELD_WEB_ROOT=/app/web` and the API serves the frontend at `/`. Worker runs as a separate container (`docker run ... /app/worker`).

**Note:** Native PE packing (`.exe` packing) only works on Windows. Linux Docker deployment supports .NET only.

## Design system

Frontend uses a custom "cyber-glassmorphism" design system in `web/src/design-system/`. Prefer design-system primitives over new inline styles. Components: `Button`, `Card`, `Panel`, `Badge`, `Alert`, `Input`, `Select`, `Checkbox`, `Progress`.

## Critical behaviors

- **Single-download policy**: `ClaimOutputKey` atomically clears `output_key` in Redis; file is deleted from storage after successful stream. On failure, key is restored.
- **User scoping**: All jobs/uploads are namespaced by `user_id`. Cross-user access returns 404.
- **Rate limiting**: Redis-backed. 20 jobs/hour per user, 10 auth attempts/15 min per IP (configurable).
- **Auth optional**: If no `SHIELD_JWT_SECRET`, dev mode issues `"dev"` tokens (all requests pass middleware).
- **Binary type auto-detect**: Worker peeks at PE metadata to determine .NET vs native; user can override with `binary_type`.
- **Compatibility check**: After protection, worker optionally runs the output in a container or Windows VM to verify it executes. Result in `compatibility_report`.

## What needs work for live launch

1. **Payment system** — No billing yet. Prices ($9/$39/$149) are shown in UI but not enforced.
2. **Email verification** — Registration accepts any email, no verification step.
3. **Production Dockerfile/compose** — Current `docker-compose.yml` is dev-only (no volumes for storage, no SSL).
4. **Landing page** — No public-facing marketing page; app starts straight at login.
5. **Password reset** — No forgot-password flow.
6. **Admin panel** — No admin view of all users/jobs.
7. **Monitoring** — No Prometheus metrics, no alerting, no structured error tracking.
8. **CORS** — Must set `SHIELD_CORS_ORIGINS` to the production domain.
9. **SQLite backup** — Production should back up `shieldbinary.db` regularly.
10. **Rate limits** — Default 100 jobs/hour is generous for paid service; tune per tier.
