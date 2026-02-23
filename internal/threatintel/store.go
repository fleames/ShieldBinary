package threatintel

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func NewStore(dbPath string) (*Store, error) {
	if dbPath == "" {
		dbPath = "./shieldbinary.db"
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open threat intel db: %w", err)
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping threat intel db: %w", err)
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS intel_samples (
			job_id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			sample_sha256 TEXT NOT NULL,
			provider TEXT NOT NULL,
			submit_mode TEXT NOT NULL,
			status TEXT NOT NULL,
			provider_submission_id TEXT,
			last_error TEXT,
			submitted_at TEXT NOT NULL,
			tier TEXT,
			low_entropy INTEGER NOT NULL DEFAULT 0,
			polymorphic_mode INTEGER NOT NULL DEFAULT 0,
			protections_json TEXT NOT NULL DEFAULT '[]',
			passes_json TEXT NOT NULL DEFAULT '[]'
		);
		CREATE INDEX IF NOT EXISTS idx_intel_samples_status ON intel_samples(status);
		CREATE INDEX IF NOT EXISTS idx_intel_samples_sha ON intel_samples(sample_sha256);

		CREATE TABLE IF NOT EXISTS intel_results (
			sample_sha256 TEXT NOT NULL,
			provider TEXT NOT NULL,
			analysis_status TEXT NOT NULL,
			detected_count INTEGER NOT NULL DEFAULT 0,
			engine_count INTEGER NOT NULL DEFAULT 0,
			verdict_ratio REAL NOT NULL DEFAULT 0,
			first_seen TEXT NOT NULL,
			last_seen TEXT NOT NULL,
			raw_summary_json TEXT NOT NULL DEFAULT '{}',
			PRIMARY KEY(sample_sha256, provider)
		);

		CREATE TABLE IF NOT EXISTS technique_signals (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			technique_key TEXT NOT NULL,
			window_start TEXT NOT NULL,
			window_end TEXT NOT NULL,
			sample_count INTEGER NOT NULL,
			detected_ratio REAL NOT NULL,
			trend REAL NOT NULL DEFAULT 0,
			flagged INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL
		);

		CREATE TABLE IF NOT EXISTS technique_flags (
			technique_key TEXT PRIMARY KEY,
			severity TEXT NOT NULL,
			reason TEXT NOT NULL,
			opened_at TEXT NOT NULL,
			closed_at TEXT,
			state TEXT NOT NULL,
			last_detected_ratio REAL NOT NULL DEFAULT 0,
			last_sample_count INTEGER NOT NULL DEFAULT 0
		);
	`)
	return err
}

func (s *Store) UpsertSample(rec SampleRecord) error {
	protectionsJSON, _ := json.Marshal(rec.Protections)
	passesJSON, _ := json.Marshal(rec.Passes)
	ts := rec.SubmittedAt
	if ts.IsZero() {
		ts = time.Now().UTC()
	}
	_, err := s.db.Exec(`
		INSERT INTO intel_samples(job_id, user_id, sample_sha256, provider, submit_mode, status, provider_submission_id, last_error, submitted_at, tier, low_entropy, polymorphic_mode, protections_json, passes_json)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(job_id) DO UPDATE SET
			user_id=excluded.user_id,
			sample_sha256=excluded.sample_sha256,
			provider=excluded.provider,
			submit_mode=excluded.submit_mode,
			status=excluded.status,
			provider_submission_id=excluded.provider_submission_id,
			last_error=excluded.last_error,
			tier=excluded.tier,
			low_entropy=excluded.low_entropy,
			polymorphic_mode=excluded.polymorphic_mode,
			protections_json=excluded.protections_json,
			passes_json=excluded.passes_json
	`, rec.JobID, rec.UserID, rec.SampleSHA256, rec.Provider, rec.SubmitMode, rec.Status, rec.ProviderSubmissionID, rec.LastError, ts.Format(time.RFC3339), rec.Tier, boolInt(rec.LowEntropy), boolInt(rec.PolymorphicMode), string(protectionsJSON), string(passesJSON))
	return err
}

func (s *Store) GetSampleByJobID(jobID string) (*SampleRecord, error) {
	row := s.db.QueryRow(`
		SELECT job_id, user_id, sample_sha256, provider, submit_mode, status, provider_submission_id, last_error, submitted_at, tier, low_entropy, polymorphic_mode, protections_json, passes_json
		FROM intel_samples WHERE job_id = ?
	`, jobID)
	var rec SampleRecord
	var submittedAt string
	var lowEntropy, polymorphic int
	var protectionsJSON, passesJSON string
	if err := row.Scan(&rec.JobID, &rec.UserID, &rec.SampleSHA256, &rec.Provider, &rec.SubmitMode, &rec.Status, &rec.ProviderSubmissionID, &rec.LastError, &submittedAt, &rec.Tier, &lowEntropy, &polymorphic, &protectionsJSON, &passesJSON); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	rec.LowEntropy = lowEntropy == 1
	rec.PolymorphicMode = polymorphic == 1
	_ = json.Unmarshal([]byte(protectionsJSON), &rec.Protections)
	_ = json.Unmarshal([]byte(passesJSON), &rec.Passes)
	rec.SubmittedAt, _ = time.Parse(time.RFC3339, submittedAt)
	return &rec, nil
}

func (s *Store) ListPendingSamples(limit int) ([]SampleRecord, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := s.db.Query(`
		SELECT job_id, user_id, sample_sha256, provider, submit_mode, status, provider_submission_id, last_error, submitted_at, tier, low_entropy, polymorphic_mode, protections_json, passes_json
		FROM intel_samples WHERE status IN ('submitted', 'queued', 'pending') ORDER BY submitted_at ASC LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SampleRecord
	for rows.Next() {
		var rec SampleRecord
		var submittedAt string
		var lowEntropy, polymorphic int
		var protectionsJSON, passesJSON string
		if err := rows.Scan(&rec.JobID, &rec.UserID, &rec.SampleSHA256, &rec.Provider, &rec.SubmitMode, &rec.Status, &rec.ProviderSubmissionID, &rec.LastError, &submittedAt, &rec.Tier, &lowEntropy, &polymorphic, &protectionsJSON, &passesJSON); err != nil {
			return nil, err
		}
		rec.LowEntropy = lowEntropy == 1
		rec.PolymorphicMode = polymorphic == 1
		_ = json.Unmarshal([]byte(protectionsJSON), &rec.Protections)
		_ = json.Unmarshal([]byte(passesJSON), &rec.Passes)
		rec.SubmittedAt, _ = time.Parse(time.RFC3339, submittedAt)
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *Store) SetSampleStatus(jobID, status, lastError string) error {
	_, err := s.db.Exec(`UPDATE intel_samples SET status=?, last_error=? WHERE job_id=?`, status, lastError, jobID)
	return err
}

func (s *Store) UpsertResult(rec ResultRecord) error {
	now := time.Now().UTC()
	first := rec.FirstSeen
	if first.IsZero() {
		first = now
	}
	last := rec.LastSeen
	if last.IsZero() {
		last = now
	}
	_, err := s.db.Exec(`
		INSERT INTO intel_results(sample_sha256, provider, analysis_status, detected_count, engine_count, verdict_ratio, first_seen, last_seen, raw_summary_json)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(sample_sha256, provider) DO UPDATE SET
			analysis_status=excluded.analysis_status,
			detected_count=excluded.detected_count,
			engine_count=excluded.engine_count,
			verdict_ratio=excluded.verdict_ratio,
			last_seen=excluded.last_seen,
			raw_summary_json=excluded.raw_summary_json
	`, rec.SampleSHA256, rec.Provider, rec.AnalysisStatus, rec.DetectedCount, rec.EngineCount, rec.VerdictRatio, first.Format(time.RFC3339), last.Format(time.RFC3339), rec.RawSummaryJSON)
	return err
}

func (s *Store) GetResult(sampleSHA256, provider string) (*ResultRecord, error) {
	row := s.db.QueryRow(`
		SELECT sample_sha256, provider, analysis_status, detected_count, engine_count, verdict_ratio, first_seen, last_seen, raw_summary_json
		FROM intel_results WHERE sample_sha256=? AND provider=?
	`, sampleSHA256, provider)
	var rec ResultRecord
	var firstSeen, lastSeen string
	if err := row.Scan(&rec.SampleSHA256, &rec.Provider, &rec.AnalysisStatus, &rec.DetectedCount, &rec.EngineCount, &rec.VerdictRatio, &firstSeen, &lastSeen, &rec.RawSummaryJSON); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	rec.FirstSeen, _ = time.Parse(time.RFC3339, firstSeen)
	rec.LastSeen, _ = time.Parse(time.RFC3339, lastSeen)
	return &rec, nil
}

func (s *Store) UpsertTechniqueSignal(sig TechniqueSignal) error {
	_, err := s.db.Exec(`
		INSERT INTO technique_signals(technique_key, window_start, window_end, sample_count, detected_ratio, trend, flagged, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)
	`, sig.TechniqueKey, sig.WindowStart.Format(time.RFC3339), sig.WindowEnd.Format(time.RFC3339), sig.SampleCount, sig.DetectedRatio, sig.Trend, boolInt(sig.Flagged), time.Now().UTC().Format(time.RFC3339))
	return err
}

func (s *Store) UpsertTechniqueFlag(flag TechniqueFlag) error {
	openedAt := flag.OpenedAt
	if openedAt.IsZero() {
		openedAt = time.Now().UTC()
	}
	closed := sql.NullString{}
	if flag.ClosedAt != nil {
		closed = sql.NullString{String: flag.ClosedAt.Format(time.RFC3339), Valid: true}
	}
	_, err := s.db.Exec(`
		INSERT INTO technique_flags(technique_key, severity, reason, opened_at, closed_at, state, last_detected_ratio, last_sample_count)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(technique_key) DO UPDATE SET
			severity=excluded.severity,
			reason=excluded.reason,
			closed_at=excluded.closed_at,
			state=excluded.state,
			last_detected_ratio=excluded.last_detected_ratio,
			last_sample_count=excluded.last_sample_count
	`, flag.TechniqueKey, flag.Severity, flag.Reason, openedAt.Format(time.RFC3339), closed, flag.State, flag.LastDetectedRatio, flag.LastSampleCount)
	return err
}

func (s *Store) ListTechniqueFlags(limit int) ([]TechniqueFlag, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`
		SELECT technique_key, severity, reason, opened_at, closed_at, state, last_detected_ratio, last_sample_count
		FROM technique_flags ORDER BY opened_at DESC LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TechniqueFlag
	for rows.Next() {
		var f TechniqueFlag
		var openedAt string
		var closedAt sql.NullString
		if err := rows.Scan(&f.TechniqueKey, &f.Severity, &f.Reason, &openedAt, &closedAt, &f.State, &f.LastDetectedRatio, &f.LastSampleCount); err != nil {
			return nil, err
		}
		f.OpenedAt, _ = time.Parse(time.RFC3339, openedAt)
		if closedAt.Valid {
			t, _ := time.Parse(time.RFC3339, closedAt.String)
			f.ClosedAt = &t
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

type SampleWithResult struct {
	SampleRecord
	DetectedCount int
	EngineCount   int
	VerdictRatio  float64
}

func (s *Store) ListSamplesWithResultsSince(since time.Time) ([]SampleWithResult, error) {
	rows, err := s.db.Query(`
		SELECT s.job_id, s.user_id, s.sample_sha256, s.provider, s.submit_mode, s.status, s.provider_submission_id, s.last_error, s.submitted_at, s.tier, s.low_entropy, s.polymorphic_mode, s.protections_json, s.passes_json,
		       COALESCE(r.detected_count, 0), COALESCE(r.engine_count, 0), COALESCE(r.verdict_ratio, 0)
		FROM intel_samples s
		LEFT JOIN intel_results r ON r.sample_sha256 = s.sample_sha256 AND r.provider = s.provider
		WHERE s.submitted_at >= ?
	`, since.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SampleWithResult
	for rows.Next() {
		var rec SampleWithResult
		var submittedAt string
		var lowEntropy, polymorphic int
		var protectionsJSON, passesJSON string
		if err := rows.Scan(&rec.JobID, &rec.UserID, &rec.SampleSHA256, &rec.Provider, &rec.SubmitMode, &rec.Status, &rec.ProviderSubmissionID, &rec.LastError, &submittedAt, &rec.Tier, &lowEntropy, &polymorphic, &protectionsJSON, &passesJSON, &rec.DetectedCount, &rec.EngineCount, &rec.VerdictRatio); err != nil {
			return nil, err
		}
		rec.LowEntropy = lowEntropy == 1
		rec.PolymorphicMode = polymorphic == 1
		rec.SubmittedAt, _ = time.Parse(time.RFC3339, submittedAt)
		_ = json.Unmarshal([]byte(protectionsJSON), &rec.Protections)
		_ = json.Unmarshal([]byte(passesJSON), &rec.Passes)
		out = append(out, rec)
	}
	return out, rows.Err()
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
