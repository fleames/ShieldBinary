package worker

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/shieldbinary/backend/internal/queue"
)

type vmRunnerRequest struct {
	BinaryType     string `json:"binary_type"`
	FileName       string `json:"file_name"`
	FileBase64     string `json:"file_base64"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

type vmRunnerResponse struct {
	Status        string `json:"status"`
	ExitCode      int    `json:"exit_code"`
	TimedOut      bool   `json:"timed_out"`
	StdoutSnippet string `json:"stdout_snippet"`
	StderrSnippet string `json:"stderr_snippet"`
	Notes         string `json:"notes"`
	RunnerID      string `json:"runner_id"`
}

func (w *Worker) runWindowsVMCompatibilityCheck(ctx context.Context, outputPath, binaryType string) *queue.CompatibilityReport {
	baseURL := strings.TrimSpace(w.cfg.VMRunnerURL)
	if baseURL == "" {
		return &queue.CompatibilityReport{
			Status: "unknown",
			Mode:   "windows_vm",
			Notes:  "windows_vm mode configured but vm_runner_url is empty",
		}
	}

	maxPayload := w.cfg.VMRunnerMaxPayloadBytes
	if maxPayload <= 0 {
		maxPayload = 120 * 1024 * 1024
	}
	st, err := os.Stat(outputPath)
	if err != nil {
		return &queue.CompatibilityReport{Status: "warning", Mode: "windows_vm", Notes: "failed to read output for VM compatibility probe"}
	}
	if st.Size() > maxPayload {
		return &queue.CompatibilityReport{
			Status: "warning",
			Mode:   "windows_vm",
			Notes:  fmt.Sprintf("output exceeds vm runner max payload (%d bytes)", maxPayload),
		}
	}

	raw, err := os.ReadFile(outputPath)
	if err != nil {
		return &queue.CompatibilityReport{Status: "warning", Mode: "windows_vm", Notes: "failed to load output for VM compatibility probe"}
	}

	timeoutSec := w.cfg.VMRunnerTimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = 45
	}
	timeout := time.Duration(timeoutSec) * time.Second
	reqCtx, cancel := context.WithTimeout(ctx, timeout+5*time.Second)
	defer cancel()

	payload := vmRunnerRequest{
		BinaryType:     binaryType,
		FileName:       filepath.Base(outputPath),
		FileBase64:     base64.StdEncoding.EncodeToString(raw),
		TimeoutSeconds: timeoutSec,
	}
	body, _ := json.Marshal(payload)

	url := strings.TrimRight(baseURL, "/") + "/compat-check"
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return &queue.CompatibilityReport{Status: "warning", Mode: "windows_vm", Notes: "failed to build vm runner request"}
	}
	req.Header.Set("Content-Type", "application/json")
	if tok := strings.TrimSpace(w.cfg.VMRunnerAuthToken); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return &queue.CompatibilityReport{Status: "warning", Mode: "windows_vm", Notes: "vm runner request failed"}
	}
	defer res.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(res.Body, 64*1024))
	if res.StatusCode >= 400 {
		return &queue.CompatibilityReport{
			Status:        "warning",
			Mode:          "windows_vm",
			StderrSnippet: clipSnippet(string(respBody), w.cfg.CompatOutputMaxBytes),
			Notes:         fmt.Sprintf("vm runner returned status %d", res.StatusCode),
		}
	}

	var parsed vmRunnerResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return &queue.CompatibilityReport{
			Status:        "warning",
			Mode:          "windows_vm",
			StderrSnippet: clipSnippet(string(respBody), w.cfg.CompatOutputMaxBytes),
			Notes:         "vm runner response parse failed",
		}
	}

	status := strings.ToLower(strings.TrimSpace(parsed.Status))
	switch status {
	case "compatible", "incompatible", "warning", "unknown":
	default:
		status = "warning"
	}
	notes := parsed.Notes
	if parsed.RunnerID != "" {
		if notes != "" {
			notes += " · "
		}
		notes += "runner " + parsed.RunnerID
	}
	return &queue.CompatibilityReport{
		Status:        status,
		Mode:          "windows_vm",
		ExitCode:      parsed.ExitCode,
		TimedOut:      parsed.TimedOut,
		StdoutSnippet: clipSnippet(parsed.StdoutSnippet, w.cfg.CompatOutputMaxBytes),
		StderrSnippet: clipSnippet(parsed.StderrSnippet, w.cfg.CompatOutputMaxBytes),
		Notes:         notes,
	}
}
