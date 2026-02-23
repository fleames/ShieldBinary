# Windows VM Runner Setup (Host Controller + Snapshot Reset)

This guide deploys the VM runner as a **host-side controller** on a Hyper-V host, not inside the guest VM.

Why this model:
- The controller can force snapshot restore before every execution.
- Untrusted binaries execute in a disposable guest VM.
- The API contract remains compatible with ShieldBinary `windows_vm` mode (`POST /compat-check`).

---

## Quick 5-minute setup

1. On the **Hyper-V host** (Administrator PowerShell), install runtime:
   ```powershell
   winget install Python.Python.3.12
   py -m pip install -r C:\path\to\BinaryProtect\tools\vm-host-controller\requirements.txt
   ```
2. Create a clean VM snapshot (once):
   ```powershell
   Checkpoint-VM -Name "ShieldRunnerVM" -SnapshotName "clean-base"
   ```
3. Set required environment variables:
   ```powershell
   setx VM_RUNNER_TOKEN "REPLACE_WITH_LONG_RANDOM_TOKEN"
   setx HYPERV_VM_NAME "ShieldRunnerVM"
   setx HYPERV_SNAPSHOT_NAME "clean-base"
   setx VM_GUEST_USERNAME "Administrator"
   setx VM_GUEST_PASSWORD "REPLACE_WITH_GUEST_PASSWORD"
   ```
4. Start controller:
   ```powershell
   cd C:\path\to\BinaryProtect\tools\vm-host-controller
   uvicorn app:app --host 0.0.0.0 --port 9090
   ```
5. Point ShieldBinary worker to host controller:
   ```yaml
   enable_compat_check: true
   compat_check_mode: windows_vm
   vm_runner_url: "http://<HYPERV_HOST_IP>:9090"
   ```
   And set on worker host:
   ```powershell
   $env:SHIELD_VM_RUNNER_AUTH_TOKEN="REPLACE_WITH_LONG_RANDOM_TOKEN"
   ```

---

## 1) Topology

- **Hyper-V Host**: runs `tools/vm-host-controller/app.py` and has Hyper-V cmdlets access.
- **Guest VM** (`ShieldRunnerVM`): executes sample binaries only.
- **ShieldBinary Worker**: sends `/compat-check` requests to host controller.

Execution flow per request:
1. Acquire single-job lock.
2. Stop VM -> restore snapshot -> start VM.
3. Wait for PowerShell Direct readiness.
4. Copy sample into guest, execute with timeout, collect outputs.
5. Return compatibility JSON.
6. Stop VM -> restore snapshot again (default enabled).

---

## 2) Host prerequisites (Hyper-V host)

Run as Administrator:

```powershell
winget install Python.Python.3.12
winget install NSSM.NSSM
```

Verify Hyper-V cmdlets exist:

```powershell
Get-Command Stop-VM, Start-VM, Restore-VMSnapshot, Copy-VMFile
```

Install Python deps:

```powershell
cd C:\path\to\BinaryProtect\tools\vm-host-controller
py -m pip install --upgrade pip
py -m pip install -r requirements.txt
```

---

## 3) Prepare guest VM baseline

Create a dedicated disposable Windows guest VM (example: `ShieldRunnerVM`), then:

1. Boot guest once and install only required runtimes (for your workloads), typically:
   - .NET runtime for `.dll` checks.
   - VC++ runtime if your native app needs it.
2. Enable Hyper-V guest service in host (needed for `Copy-VMFile`):
   ```powershell
   Enable-VMIntegrationService -VMName "ShieldRunnerVM" -Name "Guest Service Interface"
   ```
3. Shut down guest cleanly and create clean snapshot:
   ```powershell
   Stop-VM -Name "ShieldRunnerVM" -TurnOff -Force
   Checkpoint-VM -Name "ShieldRunnerVM" -SnapshotName "clean-base"
   ```

---

## 4) Controller service code location

Use the repository-provided controller:

- `tools/vm-host-controller/app.py`
- `tools/vm-host-controller/requirements.txt`

Endpoints:
- `GET /health`
- `POST /compat-check`

Notes:
- Uses a process lock (single concurrent job).
- Returns `429 runner busy` if another run is active.
- Restores snapshot before each execution.

---

## 5) Configure host controller environment

Set these on the Hyper-V host:

```powershell
setx VM_RUNNER_TOKEN "REPLACE_WITH_LONG_RANDOM_TOKEN"
setx HYPERV_VM_NAME "ShieldRunnerVM"
setx HYPERV_SNAPSHOT_NAME "clean-base"
setx VM_GUEST_USERNAME "Administrator"
setx VM_GUEST_PASSWORD "REPLACE_WITH_GUEST_PASSWORD"
```

Optional tuning:

```powershell
setx VM_RUNNER_ID "hyperv-host-1"
setx VM_RUNNER_MAX_B64_BYTES "178257920"
setx HYPERV_BOOT_TIMEOUT_SEC "120"
setx VM_EXEC_TIMEOUT_CAP_SEC "300"
setx HYPERV_RESET_AFTER_RUN "1"
setx VM_GUEST_DROP_DIR "C:\vm-runner"
```

Open a new shell after `setx`.

---

## 6) Run manually (first validation)

```powershell
cd C:\path\to\BinaryProtect\tools\vm-host-controller
uvicorn app:app --host 0.0.0.0 --port 9090
```

In another shell:

```powershell
Invoke-WebRequest "http://127.0.0.1:9090/health"
```

Expect `configured: true` when env is correct.

---

## 7) Install as Windows service (NSSM)

```powershell
$nssm = "C:\Program Files\nssm\nssm.exe"
$py = "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"
$workDir = "C:\path\to\BinaryProtect\tools\vm-host-controller"

& $nssm install VMHostController $py "-m uvicorn app:app --host 0.0.0.0 --port 9090"
& $nssm set VMHostController AppDirectory $workDir
& $nssm set VMHostController DisplayName "ShieldBinary VM Host Controller"
& $nssm set VMHostController Description "Hyper-V snapshot-based compatibility runner controller"
& $nssm set VMHostController Start SERVICE_AUTO_START
& $nssm set VMHostController AppStdout "C:\vm-runner\logs\host-controller.out.log"
& $nssm set VMHostController AppStderr "C:\vm-runner\logs\host-controller.err.log"
& $nssm set VMHostController AppRotateFiles 1
& $nssm set VMHostController AppRotateOnline 1
& $nssm set VMHostController AppRotateSeconds 86400
& $nssm set VMHostController AppRotateBytes 10485760
Start-Service VMHostController
Get-Service VMHostController
```

Create log dir first if missing:

```powershell
mkdir C:\vm-runner\logs -Force
```

---

## 8) Firewall and access control

Allow controller port only from worker host IP(s):

```powershell
New-NetFirewallRule -DisplayName "VM Host Controller 9090" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 9090 -RemoteAddress <WORKER_HOST_IP>
```

Do not expose this endpoint publicly without strict network controls.

---

## 9) Configure ShieldBinary worker

In `config/config.yaml`:

```yaml
enable_compat_check: true
compat_check_mode: windows_vm
vm_runner_url: "http://<HYPERV_HOST_IP>:9090"
vm_runner_timeout_sec: 45
vm_runner_max_payload_bytes: 125829120
```

Worker/API env:

```powershell
$env:SHIELD_VM_RUNNER_AUTH_TOKEN="REPLACE_WITH_LONG_RANDOM_TOKEN"
```

Restart API and worker.

---

## 10) Validate end-to-end

1. Check unauthenticated failure:
   ```powershell
   Invoke-WebRequest "http://<HYPERV_HOST_IP>:9090/compat-check" -Method POST -ContentType "application/json" -Headers @{Authorization="Bearer WRONG"} -Body "{}"
   ```
   Expect `401`.
2. Submit a ShieldBinary job.
3. In dashboard job details, confirm compatibility mode reports `windows_vm`.
4. Confirm host logs show stop/restore/start around each request.

---

## 11) Troubleshooting

- `runner busy` (429): expected if concurrent requests arrive; add VM pool for throughput.
- `configured: false` on `/health`: missing one or more required env vars.
- `Copy-VMFile` failures: ensure Guest Service Interface is enabled.
- readiness timeout: guest credentials wrong, VM booting slowly, or PowerShell Direct unavailable.
- frequent `warning`: inspect `host-controller.err.log` and verify snapshot name + VM name.

---

## 12) Hardening recommendations

- Keep guest VM disposable and dedicated to sample execution only.
- Never browse or use email inside this guest.
- Recreate snapshot after patch cycles (do not auto-update inside baseline snapshot).
- Restrict local admin rights for controller service account where practical.
- Consider one-controller-per-VM and a scheduler if you need horizontal scale.

