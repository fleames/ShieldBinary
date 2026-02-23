# ShieldBinary Obfuscation Technique Matrix

Status key:
- Implemented: usable in current codebase
- Partial: implemented with conservative/limited scope
- Planned: not yet implemented in engine/runtime code

## Core techniques

| Technique | Status | Notes |
|---|---|---|
| Symbol renaming (types/methods/fields/properties/events/parameters) | Implemented | Name obfuscation pass includes event and parameter renaming. |
| Sequential / Unicode / unprintable rename modes | Implemented | Unprintable mode is explicitly gated by unsafe toggle. |
| Control flow obfuscation | Implemented | Opaque predicates + control-flow flattening passes. |
| String encryption | Implemented | Per-string key derivation + decrypt helper. |
| Constant encryption | Implemented | Constant encoding and IL mutation coverage for int constants. |
| Resource encryption | Implemented | Opt-in pass with runtime transparent stream decryption. |
| Metadata reduction / stripping | Implemented | Metadata cleanup + symbol stripping. |
| Reference proxying | Implemented | Opt-in pass rewrites direct call and guarded callvirt sites. |
| Virtual method call proxying | Partial | Guarded callvirt support; advanced generics/value-type cases deferred. |
| Type scrambling | Implemented | Opt-in type and nested-type order scrambling. |
| IL code mutation | Implemented | Conservative equivalent substitution for integer constants. |
| Dead code injection / junk IL insertion | Implemented | Dedicated dead code insertion pass. |
| Invalid metadata injection | Implemented | Conservative confusable metadata injections (opt-in). |
| Anti-ILDasm attribute injection | Implemented | Dedicated anti-ILDASM pass. |
| Anti-decompiler tricks | Partial | Conservative unusual IL patterns; aggressive invalid IL not enabled. |
| Method body encryption (decrypt on first call) | Partial | Bootstrap implementation for simple int constant-returning methods. |
| Method call hiding via delegates | Implemented | Opt-in delegate proxy pass for conservative static-call scope. |
| Dynamic method generation at runtime | Implemented | Opt-in runtime warmup using DynamicMethod. |
| Reflection-based dispatch | Implemented | Opt-in reflection dispatch proxies for conservative static-call scope. |
| Assembly embedding (resources -> decrypt -> load) | Implemented | Opt-in pass embeds local deps and injects AssemblyResolve loader. |
| Assembly virtualization (IL -> custom VM) | Implemented | Existing virtualization pass + VmRuntime pipeline. |

## Packaging / deployment hardening

| Technique | Status | Notes |
|---|---|---|
| Assembly merging (ILMerge/ILRepack) | Implemented | ILRepack scripts + Makefile workflow integrated. |
| .NET Native / NativeAOT compilation | Implemented | Included in publish profiles as best-effort target. |
| ReadyToRun (R2R) compilation | Implemented | Included in publish profile scripts. |
| Single-file publish | Implemented | Included in publish profile scripts. |
| Trimming | Implemented | Included in publish profile scripts (partial trim mode). |

## Next high-impact upgrades

1. Expand method-body encryption beyond constant-returning methods.
2. Broaden virtual proxying to generic/value-type-safe scenarios.
3. Add optional advanced anti-decompiler profile with strict compatibility test gates.
