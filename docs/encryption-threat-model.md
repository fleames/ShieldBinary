# Backend Processing Encryption Threat Model

## Scope

This document covers backend processing from upload to protected output delivery:

1. API receives `.exe`/`.dll` input.
2. Worker processes the job via .NET engine or native packer.
3. Output is stored and downloaded once.

## Security Objectives

- Detect tampering of packed native payloads before execution.
- Keep payload confidentiality as best effort within loader-based execution constraints.
- Distinguish anti-reversing obfuscation from cryptographic guarantees.
- Minimize plaintext-on-disk lifetime when the loader executes protected payloads.

## Non-Goals

- Full DRM-grade prevention against a privileged local attacker with runtime control.
- Claiming string obfuscation as strong cryptographic secrecy.

## Threats and Controls

- **Payload tampering in transit/storage**
  - Control: authenticated encryption for native packed payloads (AES-GCM).
  - Behavior: loader fails closed when authentication fails.

- **Static extraction of protected payload bytes**
  - Control: compressed + encrypted payload, loader key derivation at runtime.
  - Residual risk: key material and plaintext become observable to a local runtime attacker.

- **Legacy weak format usage**
  - Control: keep read-only compatibility for existing payloads, write only modern authenticated format.
  - Residual risk: old artifacts remain weaker until re-packed.

- **Plaintext artifact leakage during execution**
  - Control: unique temp file creation, strict cleanup, best-effort overwrite on delete.
  - Residual risk: OS caching/forensics can still recover traces.

- **Confusion between obfuscation and encryption in .NET string protection**
  - Control: explicit terminology in code/docs, stronger per-string derivation replacing fixed key behavior.
  - Residual risk: determined reverse engineers can still recover runtime strings.

## Operator Guidance

- Prefer current pack format outputs; re-protect old binaries to migrate off legacy formats.
- Use `engine_low_entropy` for AV-heuristic tuning, not for stronger secrecy.
- Treat protected binaries as hardened artifacts, not as perfect secret containers.
