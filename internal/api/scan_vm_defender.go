package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/shieldbinary/backend/internal/scanner"
)

type vmAVScanRequest struct {
	FileName       string `json:"file_name"`
	FileBase64     string `json:"file_base64"`
	TimeoutSeconds int    `json:"timeout_seconds"`
}

type vmAVThreat struct {
	Name string `json:"name"`
}

type vmAVScanResponse struct {
	Status        string       `json:"status"`
	Engine        string       `json:"engine"`
	Threats       []vmAVThreat `json:"threats"`
	TimedOut      bool         `json:"timed_out"`
	StdoutSnippet string       `json:"stdout_snippet"`
	StderrSnippet string       `json:"stderr_snippet"`
	Notes         string       `json:"notes"`
	RunnerID      string       `json:"runner_id"`
}

func (s *Server) scanWithVMDefender(ctx context.Context, fileName string, data []byte) (*scanner.AVReport, error) {
	baseURL := strings.TrimSpace(s.cfg.VMScanURL)
	if baseURL == "" {
		return nil, fmt.Errorf("vm scan mode enabled but vm_scan_url is empty")
	}
	maxPayload := s.cfg.VMScanMaxPayloadBytes
	if maxPayload <= 0 {
		maxPayload = 120 * 1024 * 1024
	}
	if int64(len(data)) > maxPayload {
		return &scanner.AVReport{
			Provider: "windows_defender",
			Mode:     "windows_vm",
			Verdict:  "warning",
			Notes:    fmt.Sprintf("sample exceeds vm scan max payload (%d bytes)", maxPayload),
		}, nil
	}

	timeoutSec := s.cfg.VMScanTimeoutSec
	if timeoutSec <= 0 {
		timeoutSec = 90
	}
	reqBody, _ := json.Marshal(vmAVScanRequest{
		FileName:       filepath.Base(fileName),
		FileBase64:     base64.StdEncoding.EncodeToString(data),
		TimeoutSeconds: timeoutSec,
	})
	reqCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec+10)*time.Second)
	defer cancel()

	url := strings.TrimRight(baseURL, "/") + "/av-scan"
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("build vm scan request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if tok := strings.TrimSpace(s.cfg.VMScanAuthToken); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("vm scan request failed: %w", err)
	}
	defer res.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(res.Body, 128*1024))
	if res.StatusCode >= 400 {
		return &scanner.AVReport{
			Provider:      "windows_defender",
			Mode:          "windows_vm",
			Verdict:       "warning",
			StderrSnippet: clipSnippet(string(respBody), 1200),
			Notes:         fmt.Sprintf("vm scan returned status %d", res.StatusCode),
		}, nil
	}

	var parsed vmAVScanResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return &scanner.AVReport{
			Provider:      "windows_defender",
			Mode:          "windows_vm",
			Verdict:       "warning",
			StderrSnippet: clipSnippet(string(respBody), 1200),
			Notes:         "vm scan response parse failed",
		}, nil
	}

	verdict := strings.ToLower(strings.TrimSpace(parsed.Status))
	switch verdict {
	case "clean", "infected", "warning", "unknown":
	default:
		verdict = "warning"
	}

	var names []string
	for _, th := range parsed.Threats {
		name := strings.TrimSpace(th.Name)
		if name == "" {
			continue
		}
		names = append(names, name)
	}

	provider := strings.TrimSpace(parsed.Engine)
	if provider == "" {
		provider = "windows_defender"
	}
	return &scanner.AVReport{
		Provider:      provider,
		Mode:          "windows_vm",
		Verdict:       verdict,
		ThreatNames:   names,
		ThreatCount:   len(names),
		TimedOut:      parsed.TimedOut,
		RunnerID:      parsed.RunnerID,
		StdoutSnippet: clipSnippet(parsed.StdoutSnippet, 1200),
		StderrSnippet: clipSnippet(parsed.StderrSnippet, 1200),
		Notes:         parsed.Notes,
	}, nil
}

func clipSnippet(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max]
}
