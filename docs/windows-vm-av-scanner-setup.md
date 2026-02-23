# Windows Defender VM Scan Service Setup

This guide deploys a host-side AV scan controller that runs **Windows Defender** in a disposable Hyper-V guest VM and restores a clean snapshot after every scan.

Service location:
- `tools/vm-av-controller/app.py`
- `tools/vm-av-controller/requirements.txt`

API endpoint:
- `POST /av-scan` (Bearer auth)
- `GET /health`

## Quick 5-minute setup

1. On Hyper-V host (Admin PowerShell):
   ```powershell
   winget install Python.Python.3.12
   py -m pip install -r C:\path\to\BinaryProtect\tools\vm-av-controller\requirements.txt
   ```
2. Ensure clean snapshot exists:
   ```powershell
   Checkpoint-VM -Name "ShieldRunnerVM" -SnapshotName "clean-base"
   ```
3. Set environment:
   ```powershell
   setx VM_SCAN_TOKEN "REPLACE_WITH_LONG_RANDOM_TOKEN"
   setx HYPERV_VM_NAME "ShieldRunnerVM"
   setx HYPERV_SNAPSHOT_NAME "clean-base"
   setx VM_GUEST_USERNAME "Administrator"
   setx VM_GUEST_PASSWORD "REPLACE_WITH_GUEST_PASSWORD"
   ```
4. Start service:
   ```powershell
   cd C:\path\to\BinaryProtect\tools\vm-av-controller
   uvicorn app:app --host 0.0.0.0 --port 9091
   ```
5. Configure ShieldBinary API:
   ```yaml
   enable_vm_scan: true
   vm_scan_mode: windows_vm_defender
   vm_scan_url: "http://<HYPERV_HOST_IP>:9091"
   ```
   and set:
   ```powershell
   $env:SHIELD_VM_SCAN_AUTH_TOKEN="REPLACE_WITH_LONG_RANDOM_TOKEN"
   ```

## Behavior

For every `/av-scan` request:
1. Stop VM
2. Restore `clean-base` snapshot
3. Start VM and wait for PowerShell Direct
4. Copy file into guest
5. Run Defender custom scan (`MpCmdRun.exe -Scan -ScanType 3 -File <path> -DisableRemediation`)
6. Collect threat detections and snippets
7. Stop VM and restore snapshot again

Single-job lock is enforced; concurrent scans receive `429 runner busy`.

## Optional env tuning

```powershell
setx VM_SCAN_RUNNER_ID "hyperv-av-host-1"
setx VM_SCAN_MAX_B64_BYTES "178257920"
setx VM_SCAN_TIMEOUT_CAP_SEC "300"
setx HYPERV_BOOT_TIMEOUT_SEC "120"
setx HYPERV_RESET_AFTER_SCAN "1"
setx VM_GUEST_DROP_DIR "C:\vm-scan"
```

## Install as NSSM service

```powershell
$nssm = "C:\Program Files\nssm\nssm.exe"
$py = "C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe"
$workDir = "C:\path\to\BinaryProtect\tools\vm-av-controller"

& $nssm install VMAVController $py "-m uvicorn app:app --host 0.0.0.0 --port 9091"
& $nssm set VMAVController AppDirectory $workDir
& $nssm set VMAVController DisplayName "ShieldBinary VM AV Controller"
& $nssm set VMAVController Description "Hyper-V snapshot-backed Windows Defender scan controller"
& $nssm set VMAVController Start SERVICE_AUTO_START
Start-Service VMAVController
Get-Service VMAVController
```

## Validation

1. Health check:
   ```powershell
   Invoke-WebRequest "http://127.0.0.1:9091/health"
   ```
2. Wrong-token check (expect 401):
   ```powershell
   Invoke-WebRequest "http://127.0.0.1:9091/av-scan" -Method POST -ContentType "application/json" -Headers @{Authorization="Bearer WRONG"} -Body "{}"
   ```
3. Use Scan page in ShieldBinary and verify `av_report` appears.

## Notes

- Defender signatures should be updated in your baseline snapshot whenever you refresh the image.
- Keep this service internal-only; restrict firewall to API host IP.
