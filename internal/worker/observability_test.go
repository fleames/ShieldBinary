package worker

import (
	"testing"

	"github.com/shieldbinary/backend/internal/queue"
)

func TestParseEngineTelemetry(t *testing.T) {
	out := `
[engine-telemetry]{"type":"pass_metric","pass":"string_encryption","duration_ms":14,"success":true,"size_delta":11}
[engine-telemetry]{"type":"pass_metric","pass":"name_obfuscation","duration_ms":8,"success":false,"error":"bad metadata","size_delta":-3}
[engine-telemetry]{"type":"pipeline_summary","output_size":220}
`
	obs := parseEngineTelemetry(out, 200)
	if obs == nil {
		t.Fatal("expected telemetry output")
	}
	if len(obs.PassMetrics) != 2 {
		t.Fatalf("expected 2 pass metrics, got %d", len(obs.PassMetrics))
	}
	if obs.SizeImpact == nil || obs.SizeImpact.InputBytes != 200 || obs.SizeImpact.OutputBytes != 220 {
		t.Fatalf("unexpected size impact: %+v", obs.SizeImpact)
	}
	if obs.SizeImpact.PassDeltas["string_encryption"] != 11 {
		t.Fatalf("unexpected pass delta map: %+v", obs.SizeImpact.PassDeltas)
	}
}

func TestBuildStrengthScoreDeterministic(t *testing.T) {
	job := &queue.JobPayload{
		Tier:        "enterprise",
		Protections: []string{"runtime_rasp", "reference_proxy"},
		Polymorphic: true,
	}
	compat := &queue.CompatibilityReport{Status: "compatible"}
	metrics := []queue.PassMetric{
		{Name: "a", Success: true},
		{Name: "b", Success: true},
		{Name: "c", Success: false},
	}
	score := buildStrengthScore(job, compat, metrics)
	if score.Score < 70 || score.Score > 100 {
		t.Fatalf("unexpected score range: %+v", score)
	}
	if score.Band == "" || score.TimeEstimate == "" {
		t.Fatalf("expected band and estimate: %+v", score)
	}
}

func TestBuildRetrySuggestions(t *testing.T) {
	job := &queue.JobPayload{
		Tier:        "enterprise",
		LowEntropy:  true,
		Polymorphic: true,
		Protections: []string{"invalid_metadata", "resource_encryption"},
	}
	s := buildRetrySuggestions(job, "compatibility issue")
	if len(s) == 0 {
		t.Fatal("expected suggestions")
	}
	if s[0].Tier == "" {
		t.Fatalf("expected tier in first suggestion: %+v", s[0])
	}
}
