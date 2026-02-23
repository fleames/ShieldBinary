package worker

import (
	"encoding/json"
	"strings"

	"github.com/shieldbinary/backend/internal/queue"
)

const engineTelemetryPrefix = "[engine-telemetry]"

type engineObservability struct {
	PassMetrics []queue.PassMetric
	SizeImpact  *queue.SizeImpact
}

type telemetryPassMetric struct {
	Type       string `json:"type"`
	Pass       string `json:"pass"`
	DurationMs int64  `json:"duration_ms"`
	Success    bool   `json:"success"`
	Error      string `json:"error,omitempty"`
	SizeBefore int64  `json:"size_before,omitempty"`
	SizeAfter  int64  `json:"size_after,omitempty"`
	SizeDelta  int64  `json:"size_delta,omitempty"`
}

type telemetryPipelineSummary struct {
	Type       string `json:"type"`
	OutputSize int64  `json:"output_size"`
}

func parseEngineTelemetry(output string, inputBytes int64) *engineObservability {
	lines := strings.Split(output, "\n")
	var passMetrics []queue.PassMetric
	sizeImpact := &queue.SizeImpact{
		InputBytes: inputBytes,
		PassDeltas: map[string]int64{},
	}
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, engineTelemetryPrefix) {
			continue
		}
		payload := strings.TrimPrefix(line, engineTelemetryPrefix)
		var pm telemetryPassMetric
		if err := json.Unmarshal([]byte(payload), &pm); err == nil && pm.Type == "pass_metric" {
			passMetrics = append(passMetrics, queue.PassMetric{
				Name:           pm.Pass,
				DurationMs:     pm.DurationMs,
				Success:        pm.Success,
				Error:          pm.Error,
				SizeDeltaBytes: pm.SizeDelta,
			})
			sizeImpact.PassDeltas[pm.Pass] += pm.SizeDelta
			continue
		}
		var ps telemetryPipelineSummary
		if err := json.Unmarshal([]byte(payload), &ps); err == nil && ps.Type == "pipeline_summary" {
			sizeImpact.OutputBytes = ps.OutputSize
		}
	}
	if len(passMetrics) == 0 && sizeImpact.OutputBytes == 0 {
		return nil
	}
	return &engineObservability{
		PassMetrics: passMetrics,
		SizeImpact:  sizeImpact,
	}
}

func buildStrengthScore(job *queue.JobPayload, compat *queue.CompatibilityReport, metrics []queue.PassMetric) *queue.StrengthScore {
	score := 20
	switch strings.ToLower(job.Tier) {
	case "basic":
		score += 20
	case "pro":
		score += 35
	case "enterprise":
		score += 50
	}
	score += len(job.Protections) * 3
	if job.Polymorphic {
		score += 8
	}
	if job.LowEntropy {
		score -= 5
	}
	successfulPasses := 0
	for _, m := range metrics {
		if m.Success {
			successfulPasses++
		}
	}
	score += successfulPasses / 3
	if compat != nil {
		switch compat.Status {
		case "incompatible":
			score -= 15
		case "warning":
			score -= 7
		}
	}
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	band := "Low"
	estimate := "estimated under 2 hours for a skilled analyst"
	switch {
	case score >= 80:
		band = "VeryStrong"
		estimate = "estimated 8+ hours for a skilled analyst"
	case score >= 65:
		band = "Strong"
		estimate = "estimated 4-8 hours for a skilled analyst"
	case score >= 45:
		band = "Moderate"
		estimate = "estimated 2-4 hours for a skilled analyst"
	}
	return &queue.StrengthScore{
		Score:        score,
		Band:         band,
		TimeEstimate: estimate,
	}
}

func buildRetrySuggestions(job *queue.JobPayload, errMsg string) []queue.RetrySuggestion {
	var out []queue.RetrySuggestion
	tier := strings.ToLower(job.Tier)
	if tier == "enterprise" {
		out = append(out, queue.RetrySuggestion{
			Label:       "Retry with Pro tier",
			Reason:      "Reduce aggressive enterprise-only transforms",
			Tier:        "pro",
			Protections: filterHighRiskProtections(job.Protections),
		})
	}
	if tier == "pro" || tier == "enterprise" {
		out = append(out, queue.RetrySuggestion{
			Label:       "Retry with Basic tier",
			Reason:      "Use more compatible baseline protection path",
			Tier:        "basic",
			Polymorphic: false,
			Protections: []string{},
		})
	}
	if len(job.Protections) > 0 {
		out = append(out, queue.RetrySuggestion{
			Label:       "Disable high-risk opt-ins",
			Reason:      "Aggressive opt-ins can break some assemblies",
			Tier:        tier,
			Polymorphic: job.Polymorphic,
			LowEntropy:  job.LowEntropy,
			Protections: filterHighRiskProtections(job.Protections),
		})
	}
	if len(out) == 0 {
		out = append(out, queue.RetrySuggestion{
			Label:       "Retry with compatibility defaults",
			Reason:      "Fallback compatibility profile",
			Tier:        "basic",
			LowEntropy:  true,
			Polymorphic: false,
			Protections: []string{},
		})
	}
	return out
}

func filterHighRiskProtections(in []string) []string {
	set := map[string]bool{
		"anti_decompiler_aggressive": true,
		"invalid_metadata":           true,
		"local_var_promotion":        true,
		"runtime_rasp":               true,
	}
	var out []string
	for _, p := range in {
		if !set[strings.ToLower(strings.TrimSpace(p))] {
			out = append(out, p)
		}
	}
	return out
}
