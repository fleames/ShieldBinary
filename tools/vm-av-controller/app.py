import base64
import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="ShieldBinary VM AV Controller")

VM_SCAN_TOKEN = os.getenv("VM_SCAN_TOKEN", "").strip()
VM_NAME = os.getenv("HYPERV_VM_NAME", "").strip()
SNAPSHOT_NAME = os.getenv("HYPERV_SNAPSHOT_NAME", "clean-base").strip()
GUEST_USERNAME = os.getenv("VM_GUEST_USERNAME", "Administrator").strip()
GUEST_PASSWORD = os.getenv("VM_GUEST_PASSWORD", "")
RUNNER_ID = os.getenv("VM_SCAN_RUNNER_ID", os.getenv("COMPUTERNAME", "hyperv-av-host"))
MAX_B64_BYTES = int(os.getenv("VM_SCAN_MAX_B64_BYTES", str(170 * 1024 * 1024)))
BOOT_TIMEOUT_SEC = int(os.getenv("HYPERV_BOOT_TIMEOUT_SEC", "120"))
EXEC_TIMEOUT_CAP_SEC = int(os.getenv("VM_SCAN_TIMEOUT_CAP_SEC", "300"))
POST_RESET = os.getenv("HYPERV_RESET_AFTER_SCAN", "1").lower() in {"1", "true", "yes", "on"}
GUEST_DROP_DIR = os.getenv("VM_GUEST_DROP_DIR", r"C:\vm-scan")

_scan_lock = threading.Lock()


class AVScanRequest(BaseModel):
    file_name: str
    file_base64: str
    timeout_seconds: int = 90


def _clip(text: str, n: int = 1200) -> str:
    return (text or "")[:n]


def _auth_ok(auth_header: str | None) -> bool:
    if not VM_SCAN_TOKEN:
        return False
    if not auth_header or not auth_header.startswith("Bearer "):
        return False
    return auth_header.split(" ", 1)[1] == VM_SCAN_TOKEN


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


def _require_env() -> None:
    missing = []
    if not VM_SCAN_TOKEN:
        missing.append("VM_SCAN_TOKEN")
    if not VM_NAME:
        missing.append("HYPERV_VM_NAME")
    if not GUEST_PASSWORD:
        missing.append("VM_GUEST_PASSWORD")
    if missing:
        raise HTTPException(status_code=503, detail=f"controller not configured: missing {', '.join(missing)}")


def _reset_and_start_vm() -> None:
    script = rf"""
$ErrorActionPreference = "Stop"
Stop-VM -Name "{VM_NAME}" -TurnOff -Force -ErrorAction SilentlyContinue
Restore-VMSnapshot -VMName "{VM_NAME}" -Name "{SNAPSHOT_NAME}" -Confirm:$false
Start-VM -Name "{VM_NAME}" | Out-Null
"""
    cp = _run_powershell(script, timeout_sec=90)
    if cp.returncode != 0:
        raise RuntimeError(_clip(cp.stderr or cp.stdout, 2000) or "failed to reset/start vm")


def _wait_ready(timeout_sec: int) -> None:
    deadline = time.time() + max(10, timeout_sec)
    script = rf"""
$ErrorActionPreference = "Stop"
$sec = ConvertTo-SecureString "{GUEST_PASSWORD}" -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("{GUEST_USERNAME}", $sec)
Invoke-Command -VMName "{VM_NAME}" -Credential $cred -ScriptBlock {{ "ready" }} | Out-Null
"""
    last = ""
    while time.time() < deadline:
        cp = _run_powershell(script, timeout_sec=15)
        if cp.returncode == 0:
            return
        last = _clip(cp.stderr or cp.stdout, 400)
        time.sleep(3)
    raise RuntimeError(f"vm did not become ready: {last}")


def _scan_in_guest(local_path: str, file_name: str, timeout_sec: int) -> dict:
    guest_path = str(Path(GUEST_DROP_DIR) / file_name).replace("/", "\\")
    script = rf"""
$ErrorActionPreference = "Stop"
$sec = ConvertTo-SecureString "{GUEST_PASSWORD}" -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("{GUEST_USERNAME}", $sec)
$guestPath = "{guest_path}"
$guestDir = Split-Path -Parent $guestPath
$hostSrc = "{local_path}"
$timeout = {max(10, min(timeout_sec, EXEC_TIMEOUT_CAP_SEC))}

Invoke-Command -VMName "{VM_NAME}" -Credential $cred -ScriptBlock {{
  param($dir)
  New-Item -Path $dir -ItemType Directory -Force | Out-Null
}} -ArgumentList $guestDir

Copy-VMFile -Name "{VM_NAME}" -SourcePath $hostSrc -DestinationPath $guestPath -CreateFullPath -FileSource Host -Force

$result = Invoke-Command -VMName "{VM_NAME}" -Credential $cred -ScriptBlock {{
  param($path, $timeout)
  $out = "$path.defender.out.txt"
  $err = "$path.defender.err.txt"
  Remove-Item $out,$err -Force -ErrorAction SilentlyContinue

  $cmd = "$env:ProgramFiles\Windows Defender\MpCmdRun.exe"
  if (!(Test-Path $cmd)) {{
    $cmd = "$env:ProgramData\Microsoft\Windows Defender\Platform\*\MpCmdRun.exe"
    $cand = Get-ChildItem $cmd -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($cand) {{ $cmd = $cand.FullName }}
  }}
  if (!(Test-Path $cmd)) {{
    [PSCustomObject]@{{
      status = "warning"
      timed_out = $false
      threats = @()
      stdout_snippet = ""
      stderr_snippet = "MpCmdRun.exe not found in guest"
    }}
    return
  }}

  $args = "-Scan -ScanType 3 -File `"$path`" -DisableRemediation"
  $p = Start-Process -FilePath $cmd -ArgumentList $args -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  if ($p.WaitForExit($timeout * 1000)) {{
    $timedOut = $false
  }} else {{
    try {{ $p.Kill() }} catch {{}}
    $timedOut = $true
  }}

  $stdout = if (Test-Path $out) {{ Get-Content $out -Raw -ErrorAction SilentlyContinue }} else {{ "" }}
  $stderr = if (Test-Path $err) {{ Get-Content $err -Raw -ErrorAction SilentlyContinue }} else {{ "" }}

  $threats = @()
  try {{
    $mp = Get-MpThreatDetection -ErrorAction SilentlyContinue | Where-Object {{ $_.Resources -match [regex]::Escape($path) }}
    foreach ($t in $mp) {{
      if ($t.ThreatName) {{ $threats += [PSCustomObject]@{{ name = $t.ThreatName }} }}
    }}
  }} catch {{}}

  $status = if ($timedOut) {{ "warning" }} elseif ($threats.Count -gt 0) {{ "infected" }} else {{ "clean" }}

  Remove-Item $out,$err,$path -Force -ErrorAction SilentlyContinue
  [PSCustomObject]@{{
    status = $status
    timed_out = $timedOut
    threats = $threats
    stdout_snippet = $stdout
    stderr_snippet = $stderr
  }}
}} -ArgumentList $guestPath, $timeout

$result | ConvertTo-Json -Compress -Depth 6
"""
    cp = _run_powershell(script, timeout_sec=timeout_sec + 120)
    if cp.returncode != 0:
        raise RuntimeError(_clip(cp.stderr or cp.stdout, 2000) or "guest defender scan failed")
    import json

    return json.loads(cp.stdout.strip() or "{}")


def _reset_after_scan() -> None:
    script = rf"""
$ErrorActionPreference = "Continue"
Stop-VM -Name "{VM_NAME}" -TurnOff -Force -ErrorAction SilentlyContinue
Restore-VMSnapshot -VMName "{VM_NAME}" -Name "{SNAPSHOT_NAME}" -Confirm:$false
"""
    _run_powershell(script, timeout_sec=75)


@app.get("/health")
def health():
    configured = bool(VM_SCAN_TOKEN and VM_NAME and GUEST_PASSWORD)
    return {
        "status": "ok" if configured else "degraded",
        "configured": configured,
        "vm_name": VM_NAME,
        "snapshot_name": SNAPSHOT_NAME,
        "post_reset_enabled": POST_RESET,
        "runner_id": RUNNER_ID,
        "busy": _scan_lock.locked(),
        "engine": "windows_defender",
    }


@app.post("/av-scan")
def av_scan(req: AVScanRequest, authorization: str | None = Header(default=None)):
    if not _auth_ok(authorization):
        raise HTTPException(status_code=401, detail="unauthorized")
    _require_env()
    if not req.file_base64 or len(req.file_base64.encode("utf-8")) > MAX_B64_BYTES:
        raise HTTPException(status_code=400, detail="payload too large or empty")
    if not _scan_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="runner busy")

    timeout = max(10, min(int(req.timeout_seconds or 90), EXEC_TIMEOUT_CAP_SEC))
    file_name = os.path.basename(req.file_name or "sample.bin")
    try:
        with tempfile.TemporaryDirectory(prefix="vm_av_ctl_") as td:
            local_path = str(Path(td) / file_name)
            try:
                raw = base64.b64decode(req.file_base64)
            except Exception:
                raise HTTPException(status_code=400, detail="invalid base64 payload")
            Path(local_path).write_bytes(raw)

            _reset_and_start_vm()
            _wait_ready(BOOT_TIMEOUT_SEC)
            res = _scan_in_guest(local_path, file_name, timeout)
            status = str(res.get("status", "warning")).strip().lower()
            if status not in {"clean", "infected", "warning", "unknown"}:
                status = "warning"
            threats = res.get("threats", [])
            return {
                "status": status,
                "engine": "windows_defender",
                "threats": threats if isinstance(threats, list) else [],
                "timed_out": bool(res.get("timed_out", False)),
                "stdout_snippet": _clip(str(res.get("stdout_snippet", ""))),
                "stderr_snippet": _clip(str(res.get("stderr_snippet", ""))),
                "notes": f"defender scan via host controller on {VM_NAME}",
                "runner_id": RUNNER_ID,
            }
    except HTTPException:
        raise
    except Exception as ex:
        return {
            "status": "warning",
            "engine": "windows_defender",
            "threats": [],
            "timed_out": False,
            "stdout_snippet": "",
            "stderr_snippet": "",
            "notes": f"controller scan error: {_clip(str(ex), 800)}",
            "runner_id": RUNNER_ID,
        }
    finally:
        if POST_RESET:
            _reset_after_scan()
        _scan_lock.release()

