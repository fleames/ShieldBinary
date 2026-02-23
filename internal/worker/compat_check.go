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
	if strings.ToLower(w.cfg.CompatCheckMode) != "container" {
		return &queue.CompatibilityReport{Status: "unknown", Mode: w.cfg.CompatCheckMode, Notes: "only container mode is enabled in this rollout"}
	}
	if runtime.GOOS == "windows" && binaryType == "native" {
		return &queue.CompatibilityReport{Status: "warning", Mode: "container", Notes: "native PE container check not supported on this worker"}
	}

	timeout := time.Duration(w.cfg.CompatCheckTimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 12 * time.Second
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
