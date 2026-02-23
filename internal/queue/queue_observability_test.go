package queue

import "testing"

func TestParsePassMetricsJSON(t *testing.T) {
	raw := `[{"name":"name_obfuscation","duration_ms":12,"success":true,"size_delta_bytes":8}]`
	metrics := parsePassMetricsJSON(raw)
	if len(metrics) != 1 {
		t.Fatalf("expected 1 metric, got %d", len(metrics))
	}
	if metrics[0].Name != "name_obfuscation" || !metrics[0].Success {
		t.Fatalf("unexpected metric: %+v", metrics[0])
	}
}

func TestParseObservabilityFields(t *testing.T) {
	size := parseSizeImpactJSON(`{"input_bytes":100,"output_bytes":130,"pass_deltas":{"a":5}}`)
	if size == nil || size.OutputBytes != 130 || size.PassDeltas["a"] != 5 {
		t.Fatalf("unexpected size impact: %+v", size)
	}

	compat := parseCompatibilityReportJSON(`{"status":"warning","mode":"container","timed_out":true}`)
	if compat == nil || compat.Status != "warning" || !compat.TimedOut {
		t.Fatalf("unexpected compatibility report: %+v", compat)
	}

	score := parseStrengthScoreJSON(`{"score":72,"band":"Strong","time_estimate":"4-8h"}`)
	if score == nil || score.Score != 72 || score.Band != "Strong" {
		t.Fatalf("unexpected strength score: %+v", score)
	}

	retries := parseRetrySuggestionsJSON(`[{"label":"Retry with Pro tier","tier":"pro"}]`)
	if len(retries) != 1 || retries[0].Tier != "pro" {
		t.Fatalf("unexpected retry suggestions: %+v", retries)
	}
}

func TestMarshalOrEmpty(t *testing.T) {
	if got := marshalOrEmpty([]string(nil)); got != "[]" {
		t.Fatalf("expected [] for nil slice, got %q", got)
	}
	var size *SizeImpact
	if got := marshalOrEmpty(size); got != "{}" {
		t.Fatalf("expected {} for nil pointer, got %q", got)
	}
}
