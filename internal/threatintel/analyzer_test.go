package threatintel

import (
	"path/filepath"
	"testing"
	"time"
)

func TestAnalyzerCreatesFlags(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "intel.db")
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	defer store.Close()

	now := time.Now().UTC()
	for i := 0; i < 4; i++ {
		jobID := "job-" + string(rune('A'+i))
		if err := store.UpsertSample(SampleRecord{
			JobID:        jobID,
			UserID:       "u1",
			SampleSHA256: "sha-" + jobID,
			Provider:     "virustotal",
			SubmitMode:   "manual",
			Status:       "completed",
			SubmittedAt:  now.Add(-48 * time.Hour),
			Tier:         "pro",
			Protections:  []string{"il_mutation"},
			Passes:       []string{"opaque_predicates"},
		}); err != nil {
			t.Fatalf("upsert sample: %v", err)
		}
		detected := 0
		if i < 3 {
			detected = 1
		}
		if err := store.UpsertResult(ResultRecord{
			SampleSHA256:   "sha-" + jobID,
			Provider:       "virustotal",
			AnalysisStatus: "completed",
			DetectedCount:  detected,
			EngineCount:    1,
			VerdictRatio:   float64(detected),
			FirstSeen:      now,
			LastSeen:       now,
			RawSummaryJSON: "{}",
		}); err != nil {
			t.Fatalf("upsert result: %v", err)
		}
	}

	an := NewAnalyzer(store)
	if err := an.Run(now); err != nil {
		t.Fatalf("analyzer run: %v", err)
	}
	flags, err := store.ListTechniqueFlags(20)
	if err != nil {
		t.Fatalf("list flags: %v", err)
	}
	if len(flags) == 0 {
		t.Fatal("expected at least one technique flag")
	}
}
