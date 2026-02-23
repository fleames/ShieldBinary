import base64
import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="ShieldBinary VM Host Controller")

VM_RUNNER_TOKEN = os.getenv("VM_RUNNER_TOKEN", "").strip()
VM_NAME = os.getenv("HYPERV_VM_NAME", "").strip()
SNAPSHOT_NAME = os.getenv("HYPERV_SNAPSHOT_NAME", "clean-base").strip()
GUEST_USERNAME = os.getenv("VM_GUEST_USERNAME", "Administrator").strip()
GUEST_PASSWORD = os.getenv("VM_GUEST_PASSWORD", "")
RUNNER_ID = os.getenv("VM_RUNNER_ID", os.getenv("COMPUTERNAME", "hyperv-host"))

MAX_B64_BYTES = int(os.getenv("VM_RUNNER_MAX_B64_BYTES", str(170 * 1024 * 1024)))
BOOT_TIMEOUT_SEC = int(os.getenv("HYPERV_BOOT_TIMEOUT_SEC", "120"))
EXEC_TIMEOUT_CAP_SEC = int(os.getenv("VM_EXEC_TIMEOUT_CAP_SEC", "300"))
POST_RESET = os.getenv("HYPERV_RESET_AFTER_RUN", "1").lower() in {"1", "true", "yes", "on"}
GUEST_DROP_DIR = os.getenv("VM_GUEST_DROP_DIR", r"C:\vm-runner")

_run_lock = threading.Lock()


class CompatCheckRequest(BaseModel):
    binary_type: str
    file_name: str
    file_base64: str
    timeout_seconds: int = 45


def _auth_ok(auth_header: str | None) -> bool:
    if not VM_RUNNER_TOKEN:
        return False
    if not auth_header or not auth_header.startswith("Bearer "):
        return False
    return auth_header.split(" ", 1)[1] == VM_RUNNER_TOKEN


def _clip(text: str, n: int = 1200) -> str:
    return (text or "")[:n]


def _run_powershell(script: str, timeout_sec: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        shell=False,
    )


def _require_controller_env() -> None:
    missing = []
    if not VM_RUNNER_TOKEN:
        missing.append("VM_RUNNER_TOKEN")
    if not VM_NAME:
        missing.append("HYPERV_VM_NAME")
    if not GUEST_PASSWORD:
        missing.append("VM_GUEST_PASSWORD")
    if missing:
        raise HTTPException(
            status_code=503,
            detail=f"controller not configured: missing {', '.join(missing)}",
        )


def _reset_and_start_vm() -> None:
    # Revert guest to known-clean baseline before running untrusted sample.
    script = rf"""
$ErrorActionPreference = "Stop"
Stop-VM -Name "{VM_NAME}" -TurnOff -Force -ErrorAction SilentlyContinue
Restore-VMSnapshot -VMName "{VM_NAME}" -Name "{SNAPSHOT_NAME}" -Confirm:$false
Start-VM -Name "{VM_NAME}" | Out-Null
"""
    cp = _run_powershell(script, timeout_sec=90)
    if cp.returncode != 0:
        raise RuntimeError(_clip(cp.stderr or cp.stdout, 2000) or "failed to reset/start vm")


def _wait_for_powershell_direct(timeout_sec: int) -> None:
    deadline = time.time() + max(10, timeout_sec)
    probe_script = rf"""
$ErrorActionPreference = "Stop"
$sec = ConvertTo-SecureString "{GUEST_PASSWORD}" -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("{GUEST_USERNAME}", $sec)
Invoke-Command -VMName "{VM_NAME}" -Credential $cred -ScriptBlock {{ "ready" }} | Out-Null
"""
    last_err = ""
    while time.time() < deadline:
        cp = _run_powershell(probe_script, timeout_sec=15)
        if cp.returncode == 0:
            return
        last_err = _clip(cp.stderr or cp.stdout, 500)
        time.sleep(3)
    raise RuntimeError(f"vm did not become ready: {last_err}")


def _run_sample_in_guest(local_path: str, file_name: str, timeout_sec: int) -> dict:
    guest_path = str(Path(GUEST_DROP_DIR) / file_name).replace("/", "\\")
    ext = Path(file_name).suffix.lower()
    run_cmd = f'dotnet "{guest_path}"' if ext == ".dll" else f'"{guest_path}"'

    script = rf"""
$ErrorActionPreference = "Stop"
$sec = ConvertTo-SecureString "{GUEST_PASSWORD}" -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("{GUEST_USERNAME}", $sec)
$guestPath = "{guest_path}"
$guestDir = Split-Path -Parent $guestPath
$hostSrc = "{local_path}"
$timeout = {max(5, min(timeout_sec, EXEC_TIMEOUT_CAP_SEC))}

Invoke-Command -VMName "{VM_NAME}" -Credential $cred -ScriptBlock {{
  param($dir)
  New-Item -Path $dir -ItemType Directory -Force | Out-Null
}} -ArgumentList $guestDir

Copy-VMFile -Name "{VM_NAME}" -SourcePath $hostSrc -DestinationPath $guestPath -CreateFullPath -FileSource Host -Force

$result = Invoke-Command -VMName "{VM_NAME}" -Credential $cred -ScriptBlock {{
  param($path, $cmd, $timeout)
  $out = "$path.stdout.txt"
  $err = "$path.stderr.txt"
  Remove-Item $out,$err -Force -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c $cmd" -WorkingDirectory (Split-Path -Parent $path) -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  if ($p.WaitForExit($timeout * 1000)) {{
    $code = $p.ExitCode
    $timedOut = $false
  }} else {{
    try {{ $p.Kill() }} catch {{}}
    $code = 0
    $timedOut = $true
  }}
  $stdout = if (Test-Path $out) {{ Get-Content $out -Raw -ErrorAction SilentlyContinue }} else {{ "" }}
  $stderr = if (Test-Path $err) {{ Get-Content $err -Raw -ErrorAction SilentlyContinue }} else {{ "" }}
  Remove-Item $out,$err,$path -Force -ErrorAction SilentlyContinue
  [PSCustomObject]@{{
    exit_code = $code
    timed_out = $timedOut
    stdout_snippet = $stdout
    stderr_snippet = $stderr
  }}
}} -ArgumentList $guestPath, '{run_cmd}', $timeout

$result | ConvertTo-Json -Compress
"""
    cp = _run_powershell(script, timeout_sec=timeout_sec + 90)
    if cp.returncode != 0:
        raise RuntimeError(_clip(cp.stderr or cp.stdout, 2000) or "guest execution failed")
    import json

    parsed = json.loads(cp.stdout.strip() or "{}")
    return {
        "exit_code": int(parsed.get("exit_code", 1)),
        "timed_out": bool(parsed.get("timed_out", False)),
        "stdout_snippet": _clip(str(parsed.get("stdout_snippet", ""))),
        "stderr_snippet": _clip(str(parsed.get("stderr_snippet", ""))),
    }


def _reset_vm_after_run() -> None:
    script = rf"""
$ErrorActionPreference = "Continue"
Stop-VM -Name "{VM_NAME}" -TurnOff -Force -ErrorAction SilentlyContinue
Restore-VMSnapshot -VMName "{VM_NAME}" -Name "{SNAPSHOT_NAME}" -Confirm:$false
"""
    _run_powershell(script, timeout_sec=75)


@app.get("/health")
def health():
    configured = bool(VM_RUNNER_TOKEN and VM_NAME and GUEST_PASSWORD)
    return {
        "status": "ok" if configured else "degraded",
        "configured": configured,
        "vm_name": VM_NAME,
        "snapshot_name": SNAPSHOT_NAME,
        "post_reset_enabled": POST_RESET,
        "runner_id": RUNNER_ID,
        "busy": _run_lock.locked(),
    }


@app.post("/compat-check")
def compat_check(req: CompatCheckRequest, authorization: str | None = Header(default=None)):
    if not _auth_ok(authorization):
        raise HTTPException(status_code=401, detail="unauthorized")
    _require_controller_env()

    if not req.file_base64 or len(req.file_base64.encode("utf-8")) > MAX_B64_BYTES:
        raise HTTPException(status_code=400, detail="payload too large or empty")

    lock_acquired = _run_lock.acquire(blocking=False)
    if not lock_acquired:
        raise HTTPException(status_code=429, detail="runner busy")

    timeout = max(5, min(int(req.timeout_seconds or 45), EXEC_TIMEOUT_CAP_SEC))
    filename = os.path.basename(req.file_name or "sample.bin")

    try:
        with tempfile.TemporaryDirectory(prefix="vm_host_ctl_") as td:
            local_path = str(Path(td) / filename)
            try:
                raw = base64.b64decode(req.file_base64)
            except Exception:
                raise HTTPException(status_code=400, detail="invalid base64 payload")
            Path(local_path).write_bytes(raw)

            _reset_and_start_vm()
            _wait_for_powershell_direct(BOOT_TIMEOUT_SEC)
            result = _run_sample_in_guest(local_path, filename, timeout)

            status = "compatible" if result["exit_code"] == 0 or result["timed_out"] else "incompatible"
            notes = f"executed via host controller on {VM_NAME}"
            return {
                "status": status,
                "exit_code": result["exit_code"],
                "timed_out": result["timed_out"],
                "stdout_snippet": result["stdout_snippet"],
                "stderr_snippet": result["stderr_snippet"],
                "notes": notes,
                "runner_id": RUNNER_ID,
            }
    except HTTPException:
        raise
    except Exception as ex:
        return {
            "status": "warning",
            "exit_code": 1,
            "timed_out": False,
            "stdout_snippet": "",
            "stderr_snippet": "",
            "notes": f"controller execution error: {_clip(str(ex), 800)}",
            "runner_id": RUNNER_ID,
        }
    finally:
        if POST_RESET:
            _reset_vm_after_run()
        _run_lock.release()

