package worker

import (
	"bytes"
	"context"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/shieldbinary/backend/internal/queue"
)

func (w *Worker) runCompatibilityCheck(ctx context.Context, outputPath, binaryType string) *queue.CompatibilityReport {
	if !w.cfg.EnableCompatCheck {
		return &queue.CompatibilityReport{Status: "unknown", Mode: "disabled", Notes: "compatibility check disabled"}
	}
	mode := strings.ToLower(strings.TrimSpace(w.cfg.CompatCheckMode))
	if mode == "windows_vm" {
		return w.runWindowsVMCompatibilityCheck(ctx, outputPath, binaryType)
	}
	timeout := time.Duration(w.cfg.CompatCheckTimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 12 * time.Second
	}

	if mode != "container" {
		return &queue.CompatibilityReport{Status: "unknown", Mode: mode, Notes: "compatibility check mode not recognized; expected container or windows_vm"}
	}
	if strings.ToLower(binaryType) == "native" {
		if runtime.GOOS == "windows" {
			return runNativeCompatibilityProbe(ctx, outputPath, timeout)
		}
		return &queue.CompatibilityReport{Status: "unknown", Mode: "container", Notes: "native compatibility probe is currently supported on Windows workers only"}
	}
	checkCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	dir := filepath.Dir(outputPath)
	base := filepath.Base(outputPath)
	var cmd *exec.Cmd
	if strings.ToLower(binaryType) == "dotnet" || strings.HasSuffix(strings.ToLower(base), ".dll") {
		cmd = exec.CommandContext(
			checkCtx,
			"docker", "run", "--rm", "--network", "none", "--memory", "512m", "--cpus", "1",
			"-v", dir+":/work:ro", "-w", "/work", "mcr.microsoft.com/dotnet/runtime:8.0",
			"dotnet", "/work/"+base,
		)
	} else {
		return &queue.CompatibilityReport{Status: "warning", Mode: "container", Notes: "compatibility check currently supports .NET outputs"}
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	stdoutS := clipSnippet(stdout.String(), w.cfg.CompatOutputMaxBytes)
	stderrS := clipSnippet(stderr.String(), w.cfg.CompatOutputMaxBytes)
	report := &queue.CompatibilityReport{
		Mode:          "container",
		StdoutSnippet: stdoutS,
		StderrSnippet: stderrS,
	}
	if checkCtx.Err() == context.DeadlineExceeded {
		report.Status = "warning"
		report.TimedOut = true
		report.Notes = "launch timed out; process started but did not complete in check window"
		return report
	}
	if err != nil {
		report.Status = "incompatible"
		report.Notes = "process failed during compatibility check"
		if cmd.ProcessState != nil {
			report.ExitCode = cmd.ProcessState.ExitCode()
		}
		return report
	}
	if cmd.ProcessState != nil {
		report.ExitCode = cmd.ProcessState.ExitCode()
	}
	report.Status = "compatible"
	report.Notes = "containerized launch check passed"
	return report
}

func clipSnippet(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 {
		max = 1024
	}
	if len(s) <= max {
		return s
	}
	return s[:max]
}

func runNativeCompatibilityProbe(ctx context.Context, outputPath string, timeout time.Duration) *queue.CompatibilityReport {
	checkCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(checkCtx, outputPath)
	cmd.Dir = filepath.Dir(outputPath)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	startErr := cmd.Start()
	if startErr != nil {
		return &queue.CompatibilityReport{
			Status:        "incompatible",
			Mode:          "local_native_probe",
			StdoutSnippet: clipSnippet(stdout.String(), 1200),
			StderrSnippet: clipSnippet(stderr.String(), 1200),
			Notes:         "native launch failed during probe start",
		}
	}

	waitDone := make(chan error, 1)
	go func() {
		waitDone <- cmd.Wait()
	}()

	select {
	case err := <-waitDone:
		report := &queue.CompatibilityReport{
			Mode:          "local_native_probe",
			StdoutSnippet: clipSnippet(stdout.String(), 1200),
			StderrSnippet: clipSnippet(stderr.String(), 1200),
		}
		if cmd.ProcessState != nil {
			report.ExitCode = cmd.ProcessState.ExitCode()
		}
		if err != nil {
			report.Status = "incompatible"
			report.Notes = "native process exited with failure during probe"
			return report
		}
		report.Status = "compatible"
		report.Notes = "native process launched and exited during probe"
		return report
	case <-checkCtx.Done():
		_ = cmd.Process.Kill()
		<-waitDone
		return &queue.CompatibilityReport{
			Status:        "compatible",
			Mode:          "local_native_probe",
			TimedOut:      true,
			StdoutSnippet: clipSnippet(stdout.String(), 1200),
			StderrSnippet: clipSnippet(stderr.String(), 1200),
			Notes:         "native process launched and remained running past probe timeout",
		}
	}
}
