package threatintel

import "time"

type SampleRecord struct {
	JobID                string
	UserID               string
	SampleSHA256         string
	Provider             string
	SubmitMode           string
	Status               string // submitted|queued|pending|completed|failed
	ProviderSubmissionID string
	LastError            string
	SubmittedAt          time.Time
	Tier                 string
	LowEntropy           bool
	PolymorphicMode      bool
	Protections          []string
	Passes               []string
}

type ResultRecord struct {
	SampleSHA256   string
	Provider       string
	AnalysisStatus string
	DetectedCount  int
	EngineCount    int
	VerdictRatio   float64
	FirstSeen      time.Time
	LastSeen       time.Time
	RawSummaryJSON string
}

type TechniqueSignal struct {
	TechniqueKey  string    `json:"technique_key"`
	WindowStart   time.Time `json:"window_start"`
	WindowEnd     time.Time `json:"window_end"`
	SampleCount   int       `json:"sample_count"`
	DetectedRatio float64   `json:"detected_ratio"`
	Trend         float64   `json:"trend"`
	Flagged       bool      `json:"flagged"`
}

type TechniqueFlag struct {
	TechniqueKey      string     `json:"technique_key"`
	Severity          string     `json:"severity"`
	Reason            string     `json:"reason"`
	OpenedAt          time.Time  `json:"opened_at"`
	ClosedAt          *time.Time `json:"closed_at,omitempty"`
	State             string     `json:"state"` // open|closed
	LastDetectedRatio float64    `json:"last_detected_ratio"`
	LastSampleCount   int        `json:"last_sample_count"`
}

type FileIntelligence struct {
	SHA256         string
	AnalysisStatus string // completed|queued|pending
	DetectedCount  int
	EngineCount    int
	ProviderID     string // hash or analysis id
	RawSummaryJSON string
}

type Client interface {
	LookupHash(hash string) (*FileIntelligence, error)
	SubmitFile(filename string, content []byte) (*FileIntelligence, error)
	GetAnalysis(analysisID string) (*FileIntelligence, error)
}
