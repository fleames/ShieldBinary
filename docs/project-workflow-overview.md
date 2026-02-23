# ShieldBinary Project Workflow and Overview

This document explains what each part of the project does and how a protection job moves through the system.

## 1) High-level purpose

ShieldBinary is a binary protection platform with two processing paths:

- .NET assemblies (`.dll`, `.exe`) are processed by the `engine/` pipeline (dnlib-based obfuscation/protection).
- Native Windows PE binaries are processed by the Go native packer/loader flow.

The user interacts through a React dashboard, jobs are queued in Redis, and a Go worker performs the protection and stores outputs.

## 2) Project map (what is what)

- `web/`
  - React frontend (dashboard, auth, tiers page).
  - Lets users upload files, choose tier/settings, submit jobs, poll status, and download results.
- `cmd/api`
  - Go API server (`Gin`) for auth, upload/download, job creation, job listing, and deletion.
- `cmd/worker`
  - Go worker process that dequeues jobs and runs the correct protection path.
- `internal/api`
  - API handlers, request validation/sanitization, route logic.
- `internal/queue`
  - Redis queue and job metadata persistence (`JobPayload`, status/progress helpers).
- `internal/worker`
  - Core worker orchestration: download input, detect binary type, call engine or native packer, upload output.
- `internal/nativepacker`
  - Native payload packing/encryption logic (current authenticated format support included in loader flow).
- `cmd/loader`
  - Native loader stub for protected native outputs.
- `engine/`
  - .NET protection engine (passes for obfuscation, mutation, anti-analysis, etc.).
- `VmRuntime/`
  - Runtime support for virtualization features.
- `internal/storage`
  - Storage abstraction (local or S3-compatible backend).
- `internal/auth`
  - Auth model/storage/token helpers.
- `scripts/`
  - Convenience scripts for local run, publish profiles, and assembly merging.
- `docs/`
  - Security findings, threat model, obfuscation matrix, and this overview.

## 3) Runtime architecture

Main runtime components:

1. Frontend (`web`) -> submits API requests.
2. API (`cmd/api`) -> validates requests, stores job metadata in Redis, enqueues work.
3. Redis (`internal/queue`) -> queue + per-job hash metadata.
4. Worker (`cmd/worker`) -> processes queued jobs.
5. Storage (`internal/storage`) -> stores input and output binaries.

## 4) End-to-end job lifecycle

### Step A: Upload

1. User uploads `.exe`/`.dll` from dashboard.
2. API validates file extension and PE `MZ` signature.
3. API stores file as `inputs/<userId>/<uuid>.<ext>` in storage.
4. API returns `input_key`.

### Step B: Job creation

1. Dashboard posts `/api/v1/jobs` with:
   - `input_key`
   - `tier`
   - `binary_type` (`auto`)
   - `low_entropy`
   - `polymorphic_mode`
   - `protections` (sanitized allowlist on backend)
2. API verifies:
   - tier validity
   - `input_key` belongs to user
   - rate limits
3. API writes job hash to Redis and pushes serialized job to queue list.
4. API returns `job_id`.

### Step C: Worker processing

1. Worker BLPOPs from Redis queue.
2. Worker downloads input from storage to temp workdir.
3. Worker detects .NET vs native PE.
4. Worker runs:
   - .NET -> `runDotNetEngine(...)`
   - Native -> `runNativePacker(...)`
5. Worker updates status (`processing`, `uploading`, `completed` or `failed`) and progress.

### Step D: Output and download

1. Worker uploads output to `outputs/<userId>/<jobId>.<ext>`.
2. Worker stores `output_key`, final status, and detected `binary_type`.
3. Frontend polls `/jobs/:id` until terminal state.
4. User downloads via `/jobs/:id/download`.
5. Single-download policy clears/claims `output_key` atomically and deletes storage artifact after successful stream.

## 5) Frontend workflow (user view)

Dashboard flow:

1. Choose input file.
2. Choose protection tier.
3. (Now tier-aware) configure only relevant options.
4. Optional preset profile:
   - Compatibility
   - Balanced
   - Polymorphic
5. Submit job.
6. Watch progress.
7. Download result or retry failed job.
8. Review job history.
9. Expand details for pass metrics, compatibility report, and strength score.
10. (Optional) submit completed output to threat-intel and review technique flags.

Tier-aware UI behavior:

- Minimal: hides advanced controls that do not apply.
- Basic: focuses on safer defaults and limited controls.
- Pro/Enterprise: enables advanced controls (including polymorphic mode and opt-ins where relevant).
- Payload generation is filtered so unsupported controls are not sent.

## 6) Tier model and intent

- `minimal`
  - Highest compatibility fallback.
  - Minimal transformations.
- `basic`
  - Baseline practical protection.
- `pro`
  - Stronger obfuscation features; higher chance of compatibility edge cases.
- `enterprise`
  - Most aggressive stack, includes high-impact protections and advanced transformations.

Use `minimal`/`basic` for fragile binaries and regression-sensitive workloads; use `pro`/`enterprise` when resistance is prioritized and compatibility testing is available.

## 7) .NET engine workflow (engine/)

Entry:

- `engine/Program.cs` parses options/env vars and creates `PipelineContext`.
- Pass list is derived by tier, then filtered by optional env toggles.

Key context flags include:

- `LowEntropy` (deterministic/entropy-tuned behavior).
- `PolymorphicMode` (high-variance template behavior).
- Opt-in booleans for specific advanced passes.

Pass execution model:

1. Load module.
2. Run selected passes in sequence.
3. Optimize/simplify branches/macros.
4. Write protected assembly.

Notable options:

- Safe toggles (`SHIELD_ENGINE_SAFE`, `SHIELD_ENGINE_SAFE_PRO`).
- Pass isolation (`SHIELD_ENGINE_PASSES`) for debugging.
- Virtualization toggle (`SHIELD_ENGINE_VIRTUALIZATION`).
- Rename mode controls (`SHIELD_ENGINE_RENAME_MODE`, `SHIELD_ENGINE_RENAME_UNSAFE`).

## 8) Native protection workflow

For native PE:

1. Worker validates native path support (Windows worker required for native pack execution path).
2. Native packer packages payload with encryption/compression format.
3. Loader-compatible protected output is produced.
4. At runtime, loader extracts/decrypts and executes with temporary file handling safeguards.

## 9) Job data model (Redis perspective)

Important fields persisted in `internal/queue.JobPayload` and hash:

- `id`, `user_id`, `input_key`, `output_key`
- `tier`, `binary_type`
- `status`, `progress`, `error`
- `low_entropy`
- `polymorphic_mode`
- `protections` (JSON string array)
- `pass_metrics` (JSON array: per-pass duration, success, error, size delta)
- `size_impact` (JSON object: input bytes, output bytes, pass deltas)
- `compatibility_report` (JSON object: mode/status/exit snippets/timeout)
- `strength_score` (JSON object: score, qualitative band, analyst-time estimate)
- `retry_suggestions` (JSON array: ranked safe fallback configs)
- threat-intel sample/result metadata persisted in SQLite (`intel_samples`, `intel_results`, `technique_signals`, `technique_flags`)

## 10) Security and safety controls

- Upload validation (size, extension, PE header).
- Auth and per-user job ownership checks.
- Rate limiting.
- Storage key scoping by user.
- Fail-closed behavior on processing errors.
- Native path includes authenticated payload handling in current format support.
- Threat model and findings documented in:
  - `docs/encryption-threat-model.md`
  - `docs/encryption-security-findings.md`

## 11) Development and operations workflow

### Local run

- Preferred: `scripts/run.ps1` (Windows) or `scripts/run.sh` (Linux/macOS).
- Manual: run Redis, API, worker, frontend separately.

### Build

- Go services via `go build`.
- Engine via `dotnet build/publish`.
- Loader via `go build` for Windows target.

### Packaging helpers

- Publish profiles:
  - `scripts/publish-dotnet-profiles.ps1`
  - `scripts/publish-dotnet-profiles.sh`
- Assembly merge:
  - `scripts/merge-assemblies.ps1`
  - `scripts/merge-assemblies.sh`

## 12) Testing strategy

- Integration tests in `internal/integration/protection_test.go` validate protected outputs remain runnable for representative flows.
- Includes opt-in pass smoke coverage and publish profile smoke test gating.
- Practical workflow for regressions:
  1. Run tier test on fixture.
  2. If failure, isolate pass via `SHIELD_ENGINE_PASSES`.
  3. Adjust config/tier and retest.

## 13) Troubleshooting playbook

If a protected output fails:

1. Enable verbose engine logs (`SHIELD_ENGINE_VERBOSE=1`).
2. Isolate passes (`SHIELD_ENGINE_PASSES=...`) to find culprit.
3. Try safe mode (`SHIELD_ENGINE_SAFE=1` or `SHIELD_ENGINE_SAFE_PRO=1`).
4. Move to lower tier (`enterprise` -> `pro` -> `basic` -> `minimal`).
5. For native path, verify Windows worker + loader availability.

If two protected files have same size but different hash:

- This is expected in many cases due to alignment and fixed overhead.
- Hash difference confirms content-level variance.

## 14) Recommended team workflow

For stable production usage:

1. Start with `basic` or `pro` on a test set of binaries.
2. Record compatibility and runtime behavior.
3. Enable selective advanced opt-ins one by one.
4. Use `polymorphic_mode` for higher variance when desired.
5. Keep `low_entropy` for AV-heuristic tuning or reproducibility scenarios.
6. Promote settings to team presets once validated.

## 15) Quick glossary

- Tier: preconfigured pass strategy level.
- Opt-in protection: additional pass toggled per job.
- Low entropy: deterministic behavior to reduce output entropy variance.
- Polymorphic mode: increased mutation/template variance across builds.
- Pass: one transformation stage in the .NET pipeline.
- Worker: async processor executing queued jobs.

