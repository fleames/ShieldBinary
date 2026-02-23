package threatintel

import (
	"path/filepath"
	"testing"
	"time"
)

func TestStoreSampleLifecycle(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "intel.db")
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	defer store.Close()

	sample := SampleRecord{
		JobID:                "job-1",
		UserID:               "user-1",
		SampleSHA256:         "abc",
		Provider:             "virustotal",
		SubmitMode:           "manual",
		Status:               "pending",
		ProviderSubmissionID: "analysis-1",
		SubmittedAt:          time.Now().UTC(),
		Tier:                 "pro",
		LowEntropy:           true,
		PolymorphicMode:      false,
		Protections:          []string{"il_mutation"},
		Passes:               []string{"name_obfuscation"},
	}
	if err := store.UpsertSample(sample); err != nil {
		t.Fatalf("upsert sample: %v", err)
	}
	got, err := store.GetSampleByJobID("job-1")
	if err != nil || got == nil {
		t.Fatalf("get sample failed: %v", err)
	}
	if got.ProviderSubmissionID != "analysis-1" || got.Tier != "pro" {
		t.Fatalf("unexpected sample: %+v", got)
	}
	if err := store.UpsertResult(ResultRecord{
		SampleSHA256:   "abc",
		Provider:       "virustotal",
		AnalysisStatus: "completed",
		DetectedCount:  5,
		EngineCount:    70,
		VerdictRatio:   5.0 / 70.0,
		FirstSeen:      time.Now().UTC(),
		LastSeen:       time.Now().UTC(),
		RawSummaryJSON: "{}",
	}); err != nil {
		t.Fatalf("upsert result: %v", err)
	}
	res, err := store.GetResult("abc", "virustotal")
	if err != nil || res == nil {
		t.Fatalf("get result failed: %v", err)
	}
	if res.DetectedCount != 5 {
		t.Fatalf("unexpected result: %+v", res)
	}
}
