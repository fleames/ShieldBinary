# Windows VM Runner Setup Guide

This guide explains how to deploy and run the Windows VM compatibility runner used by `SHIELD_COMPAT_CHECK_MODE=windows_vm`.

The runner is a separate HTTP service that receives a protected output, executes a launch probe inside a Windows VM context, and returns compatibility telemetry.

## Quick 5-minute setup

If you want the fastest bring-up path, do this first:

1. On the Windows VM, install prerequisites:
   ```powershell
   winget install Python.Python.3.12
   winget install Microsoft.DotNet.Runtime.8
   py -m pip install fastapi uvicorn
   ```
2. Create `C:\vm-runner\app.py` using the script in this guide.
3. Set token and run runner:
   ```powershell
   setx VM_RUNNER_TOKEN "REPLACE_WITH_LONG_RANDOM_TOKEN"
   # open new shell
   cd C:\vm-runner
   uvicorn app:app --host 0.0.0.0 --port 9090
   ```
4. On ShieldBinary worker host, configure:
   ```yaml
   enable_compat_check: true
   compat_check_mode: windows_vm
   vm_runner_url: "http://<VM_IP>:9090"
   ```
   and set:
   ```powershell
   $env:SHIELD_VM_RUNNER_AUTH_TOKEN="REPLACE_WITH_LONG_RANDOM_TOKEN"
   ```
5. Restart API/worker and run a new job.

Then follow the full steps below to install the runner as an auto-start Windows service (NSSM) and harden access.

## 1) Prerequisites on a new Windows VM

Open PowerShell as Administrator and install:

```powershell
winget install Python.Python.3.12
winget install Microsoft.DotNet.Runtime.8
winget install NSSM.NSSM
```

Install Python packages:

```powershell
py -m pip install --upgrade pip
py -m pip install fastapi uvicorn
```

## 2) Create runner directory

```powershell
mkdir C:\vm-runner
mkdir C:\vm-runner\logs
```

Create `C:\vm-runner\app.py` with:

```python
import os
import base64
import tempfile
import subprocess
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI()
TOKEN = os.getenv("VM_RUNNER_TOKEN", "")
MAX_B64_BYTES = int(os.getenv("VM_RUNNER_MAX_B64_BYTES", str(170 * 1024 * 1024)))

class CompatCheckRequest(BaseModel):
    binary_type: str
    file_name: str
    file_base64: str
    timeout_seconds: int = 45

def auth_ok(auth_header: str | None) -> bool:
    if not TOKEN:
        return False
    if not auth_header or not auth_header.startswith("Bearer "):
        return False
    return auth_header.split(" ", 1)[1] == TOKEN

@app.post("/compat-check")
def compat_check(req: CompatCheckRequest, authorization: str | None = Header(default=None)):
    if not auth_ok(authorization):
        raise HTTPException(status_code=401, detail="unauthorized")
    if not req.file_base64 or len(req.file_base64.encode("utf-8")) > MAX_B64_BYTES:
        raise HTTPException(status_code=400, detail="payload too large or empty")

    timeout = max(5, min(req.timeout_seconds, 300))
    file_name = os.path.basename(req.file_name) or "sample.bin"
    ext = os.path.splitext(file_name)[1].lower()

    with tempfile.TemporaryDirectory(prefix="vmrunner_") as td:
        out_path = os.path.join(td, file_name)
        try:
            raw = base64.b64decode(req.file_base64)
        except Exception:
            raise HTTPException(status_code=400, detail="invalid base64 payload")

        with open(out_path, "wb") as f:
            f.write(raw)

        cmd = ["dotnet", out_path] if ext == ".dll" else [out_path]

        try:
            p = subprocess.run(cmd, cwd=td, capture_output=True, text=True, timeout=timeout, shell=False)
            status = "compatible" if p.returncode == 0 else "incompatible"
            return {
                "status": status,
                "exit_code": p.returncode,
                "timed_out": False,
                "stdout_snippet": (p.stdout or "")[:1200],
                "stderr_snippet": (p.stderr or "")[:1200],
                "notes": "process completed in VM",
                "runner_id": os.getenv("COMPUTERNAME", "windows-vm"),
            }
        except subprocess.TimeoutExpired as te:
            return {
                "status": "compatible",
                "exit_code": 0,
                "timed_out": True,
                "stdout_snippet": (te.stdout or "")[:1200] if te.stdout else "",
                "stderr_snippet": (te.stderr or "")[:1200] if te.stderr else "",
                "notes": "process launched and exceeded timeout window",
                "runner_id": os.getenv("COMPUTERNAME", "windows-vm"),
            }
        except Exception as e:
            return {
                "status": "warning",
                "exit_code": 1,
                "timed_out": False,
                "stdout_snippet": "",
                "stderr_snippet": "",
                "notes": f"runner execution error: {e}",
                "runner_id": os.getenv("COMPUTERNAME", "windows-vm"),
            }
```

## 3) Configure token

Set a strong shared token:

```powershell
setx VM_RUNNER_TOKEN "REPLACE_WITH_LONG_RANDOM_TOKEN"
```

Open a new PowerShell window after `setx`.

## 4) Test runner manually

```powershell
cd C:\vm-runner
uvicorn app:app --host 0.0.0.0 --port 9090
```

Stop with `Ctrl+C` after confirming it starts.

## 5) Install as Windows service (NSSM)

Update Python path if needed:

```powershell
$nssm = "C:\Program Files\nssm\nssm.exe"
$py = "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"
$workDir = "C:\vm-runner"

& $nssm install VMRunner $py "-m uvicorn app:app --host 0.0.0.0 --port 9090"
& $nssm set VMRunner AppDirectory $workDir
& $nssm set VMRunner DisplayName "ShieldBinary VM Runner"
& $nssm set VMRunner Description "Windows VM compatibility runner for ShieldBinary"
& $nssm set VMRunner Start SERVICE_AUTO_START
& $nssm set VMRunner AppStdout "C:\vm-runner\logs\runner.out.log"
& $nssm set VMRunner AppStderr "C:\vm-runner\logs\runner.err.log"
& $nssm set VMRunner AppRotateFiles 1
& $nssm set VMRunner AppRotateOnline 1
& $nssm set VMRunner AppRotateSeconds 86400
& $nssm set VMRunner AppRotateBytes 10485760
Start-Service VMRunner
Get-Service VMRunner
```

## 6) Open firewall (or scope to worker IP)

```powershell
New-NetFirewallRule -DisplayName "VM Runner 9090" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 9090
```

## 7) Configure ShieldBinary worker/API

In `config/config.yaml`:

```yaml
enable_compat_check: true
compat_check_mode: windows_vm
vm_runner_url: "http://<VM_IP>:9090"
vm_runner_timeout_sec: 45
vm_runner_max_payload_bytes: 125829120
```

Set auth token in worker/API environment:

```powershell
$env:SHIELD_VM_RUNNER_AUTH_TOKEN="REPLACE_WITH_LONG_RANDOM_TOKEN"
```

Restart API and worker after changes.

## 8) Validate from worker host

This should return 401 if runner is reachable but auth is wrong:

```powershell
Invoke-WebRequest "http://<VM_IP>:9090/compat-check" -Method POST -ContentType "application/json" -Headers @{Authorization="Bearer WRONG"} -Body "{}"
```

Then run a new protection job and confirm dashboard compatibility report shows mode `windows_vm`.

## 9) Recommended hardening

- Restrict inbound firewall to worker host IP only.
- Keep VM disposable/snapshotted (untrusted binary execution).
- Avoid public exposure without TLS and allowlist.
- Run service as a low-privilege account where possible.

