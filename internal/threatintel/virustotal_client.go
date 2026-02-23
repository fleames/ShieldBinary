package threatintel

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/shieldbinary/backend/internal/config"
)

type VirusTotalClient struct {
	baseURL    string
	apiKey     string
	maxRetries int
	httpClient *http.Client
}

func NewVirusTotalClient(cfg *config.Config) *VirusTotalClient {
	return &VirusTotalClient{
		baseURL:    strings.TrimRight(cfg.VTBaseURL, "/"),
		apiKey:     cfg.VTAPIKey,
		maxRetries: cfg.VTMaxRetries,
		httpClient: &http.Client{Timeout: time.Duration(cfg.ThreatIntelLookupTimeoutSec) * time.Second},
	}
}

func (c *VirusTotalClient) enabled() bool {
	return c.apiKey != ""
}

func (c *VirusTotalClient) LookupHash(hash string) (*FileIntelligence, error) {
	if !c.enabled() {
		return nil, fmt.Errorf("vt api key not configured")
	}
	respBody, status, err := c.request(http.MethodGet, "/files/"+url.PathEscape(hash), nil, "")
	if err != nil {
		return nil, err
	}
	if status == http.StatusNotFound {
		return nil, nil
	}
	if status >= 400 {
		return nil, fmt.Errorf("vt lookup failed: status=%d", status)
	}
	return parseVTFileResponse(respBody)
}

func (c *VirusTotalClient) SubmitFile(filename string, content []byte) (*FileIntelligence, error) {
	if !c.enabled() {
		return nil, fmt.Errorf("vt api key not configured")
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("file", filename)
	if err != nil {
		return nil, err
	}
	if _, err := fw.Write(content); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	respBody, status, err := c.request(http.MethodPost, "/files", &body, w.FormDataContentType())
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, fmt.Errorf("vt submit failed: status=%d", status)
	}
	return parseVTAnalysisResponse(respBody)
}

func (c *VirusTotalClient) GetAnalysis(analysisID string) (*FileIntelligence, error) {
	if !c.enabled() {
		return nil, fmt.Errorf("vt api key not configured")
	}
	respBody, status, err := c.request(http.MethodGet, "/analyses/"+url.PathEscape(analysisID), nil, "")
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, fmt.Errorf("vt analysis lookup failed: status=%d", status)
	}
	return parseVTAnalysisResponse(respBody)
}

func (c *VirusTotalClient) request(method, path string, body io.Reader, contentType string) ([]byte, int, error) {
	var payload []byte
	if body != nil {
		var err error
		payload, err = io.ReadAll(body)
		if err != nil {
			return nil, 0, err
		}
	}
	retries := c.maxRetries
	if retries < 0 {
		retries = 0
	}
	for attempt := 0; attempt <= retries; attempt++ {
		var reqBody io.Reader
		if payload != nil {
			reqBody = bytes.NewReader(payload)
		}
		req, err := http.NewRequest(method, c.baseURL+path, reqBody)
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("x-apikey", c.apiKey)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		res, err := c.httpClient.Do(req)
		if err != nil {
			if attempt < retries {
				time.Sleep(time.Duration(attempt+1) * 500 * time.Millisecond)
				continue
			}
			return nil, 0, err
		}
		b, readErr := io.ReadAll(res.Body)
		res.Body.Close()
		if readErr != nil {
			return nil, res.StatusCode, readErr
		}
		if (res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500) && attempt < retries {
			time.Sleep(time.Duration(attempt+1) * 700 * time.Millisecond)
			continue
		}
		return b, res.StatusCode, nil
	}
	return nil, 0, fmt.Errorf("vt request failed")
}

func parseVTFileResponse(body []byte) (*FileIntelligence, error) {
	var payload struct {
		Data struct {
			ID         string `json:"id"`
			Attributes struct {
				SHA256            string `json:"sha256"`
				LastAnalysisStats struct {
					Harmless   int `json:"harmless"`
					Malicious  int `json:"malicious"`
					Suspicious int `json:"suspicious"`
					Undetected int `json:"undetected"`
					Timeout    int `json:"timeout"`
				} `json:"last_analysis_stats"`
			} `json:"attributes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	stats := payload.Data.Attributes.LastAnalysisStats
	engines := stats.Harmless + stats.Malicious + stats.Suspicious + stats.Undetected + stats.Timeout
	detected := stats.Malicious + stats.Suspicious
	return &FileIntelligence{
		SHA256:         payload.Data.Attributes.SHA256,
		AnalysisStatus: "completed",
		DetectedCount:  detected,
		EngineCount:    engines,
		ProviderID:     payload.Data.ID,
		RawSummaryJSON: string(body),
	}, nil
}

func parseVTAnalysisResponse(body []byte) (*FileIntelligence, error) {
	var payload struct {
		Data struct {
			ID         string `json:"id"`
			Attributes struct {
				Status            string `json:"status"`
				SHA256            string `json:"sha256"`
				LastAnalysisStats struct {
					Harmless   int `json:"harmless"`
					Malicious  int `json:"malicious"`
					Suspicious int `json:"suspicious"`
					Undetected int `json:"undetected"`
					Timeout    int `json:"timeout"`
				} `json:"stats"`
			} `json:"attributes"`
		} `json:"data"`
		Meta map[string]interface{} `json:"meta"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	stats := payload.Data.Attributes.LastAnalysisStats
	engines := stats.Harmless + stats.Malicious + stats.Suspicious + stats.Undetected + stats.Timeout
	detected := stats.Malicious + stats.Suspicious
	status := payload.Data.Attributes.Status
	if status == "" {
		status = "queued"
	}
	if strings.EqualFold(status, "completed") {
		status = "completed"
	} else {
		status = "pending"
	}
	return &FileIntelligence{
		SHA256:         payload.Data.Attributes.SHA256,
		AnalysisStatus: status,
		DetectedCount:  detected,
		EngineCount:    engines,
		ProviderID:     payload.Data.ID,
		RawSummaryJSON: string(body),
	}, nil
}
