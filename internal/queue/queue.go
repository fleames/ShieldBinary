package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	QueueName      = "shieldbinary:jobs"
	QueuePrefix    = "shieldbinary:job:"
	UserJobsPrefix = "shieldbinary:user:"
	UserJobsSuffix = ":jobs"
	JobTTL         = 48 * 60 * 60 // 48 hours in seconds
)

type JobPayload struct {
	ID                  string               `json:"id"`
	UserID              string               `json:"user_id"`
	InputKey            string               `json:"input_key"`
	OutputKey           string               `json:"output_key,omitempty"`
	Tier                string               `json:"tier"`
	BinaryType          string               `json:"binary_type"`
	LowEntropy          bool                 `json:"low_entropy"`
	Polymorphic         bool                 `json:"polymorphic_mode"`
	Protections         []string             `json:"protections,omitempty"`
	PassMetrics         []PassMetric         `json:"pass_metrics,omitempty"`
	SizeImpact          *SizeImpact          `json:"size_impact,omitempty"`
	CompatibilityReport *CompatibilityReport `json:"compatibility_report,omitempty"`
	StrengthScore       *StrengthScore       `json:"strength_score,omitempty"`
	RetrySuggestions    []RetrySuggestion    `json:"retry_suggestions,omitempty"`
	Status              string               `json:"status"`
	Progress            int                  `json:"progress"`
	Error               string               `json:"error,omitempty"`
}

type PassMetric struct {
	Name           string `json:"name"`
	DurationMs     int64  `json:"duration_ms"`
	Success        bool   `json:"success"`
	Error          string `json:"error,omitempty"`
	SizeDeltaBytes int64  `json:"size_delta_bytes,omitempty"`
}

type SizeImpact struct {
	InputBytes  int64            `json:"input_bytes"`
	OutputBytes int64            `json:"output_bytes"`
	PassDeltas  map[string]int64 `json:"pass_deltas,omitempty"`
}

type CompatibilityReport struct {
	Status        string `json:"status"` // unknown|compatible|warning|incompatible
	Mode          string `json:"mode"`   // container|local
	ExitCode      int    `json:"exit_code,omitempty"`
	TimedOut      bool   `json:"timed_out,omitempty"`
	StdoutSnippet string `json:"stdout_snippet,omitempty"`
	StderrSnippet string `json:"stderr_snippet,omitempty"`
	Notes         string `json:"notes,omitempty"`
}

type StrengthScore struct {
	Score        int    `json:"score"` // 0-100
	Band         string `json:"band"`
	TimeEstimate string `json:"time_estimate,omitempty"`
}

type RetrySuggestion struct {
	Label       string   `json:"label"`
	Reason      string   `json:"reason,omitempty"`
	Tier        string   `json:"tier,omitempty"`
	LowEntropy  bool     `json:"low_entropy,omitempty"`
	Polymorphic bool     `json:"polymorphic_mode,omitempty"`
	Protections []string `json:"protections,omitempty"`
}

type Queue struct {
	client *redis.Client
}

func New(addr, password string, db int) (*Queue, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return &Queue{client: client}, nil
}

// Ping checks Redis connectivity (for readiness probes)
func (q *Queue) Ping(ctx context.Context) error {
	return q.client.Ping(ctx).Err()
}

func (q *Queue) Enqueue(ctx context.Context, job *JobPayload) error {
	data, err := json.Marshal(job)
	if err != nil {
		return err
	}
	return q.client.RPush(ctx, QueueName, data).Err()
}

func (q *Queue) Dequeue(ctx context.Context) (*JobPayload, error) {
	res, err := q.client.BLPop(ctx, 0, QueueName).Result()
	if err != nil {
		return nil, err
	}
	if len(res) < 2 {
		return nil, fmt.Errorf("unexpected blpop result")
	}
	var job JobPayload
	if err := json.Unmarshal([]byte(res[1]), &job); err != nil {
		return nil, err
	}
	return &job, nil
}

func (q *Queue) SetStatus(ctx context.Context, jobID, status string, progress int) error {
	key := QueuePrefix + jobID
	return q.client.HSet(ctx, key, "status", status, "progress", progress).Err()
}

func (q *Queue) SetOutputKey(ctx context.Context, jobID, outputKey string) error {
	key := QueuePrefix + jobID
	return q.client.HSet(ctx, key, "output_key", outputKey).Err()
}

// ClaimOutputKey atomically reads and clears output_key. Returns the key if claimed, empty string if already claimed.
// Used for single-download: first caller gets the key, subsequent callers get empty.
func (q *Queue) ClaimOutputKey(ctx context.Context, jobID string) (string, error) {
	key := QueuePrefix + jobID
	script := redis.NewScript(`
		local v = redis.call('HGET', KEYS[1], 'output_key')
		if v and v ~= '' then
			redis.call('HSET', KEYS[1], 'output_key', '')
			return v
		end
		return ''
	`)
	result, err := script.Run(ctx, q.client, []string{key}).Result()
	if err != nil {
		return "", err
	}
	if s, ok := result.(string); ok {
		return s, nil
	}
	return "", nil
}

func (q *Queue) SetBinaryType(ctx context.Context, jobID, binaryType string) error {
	key := QueuePrefix + jobID
	return q.client.HSet(ctx, key, "binary_type", binaryType).Err()
}

func (q *Queue) SetJobError(ctx context.Context, jobID, errMsg string) error {
	key := QueuePrefix + jobID
	return q.client.HSet(ctx, key, "error", errMsg).Err()
}

func (q *Queue) StoreJob(ctx context.Context, job *JobPayload) error {
	key := QueuePrefix + job.ID
	userJobsKey := UserJobsPrefix + job.UserID + UserJobsSuffix
	protectionsJSON := marshalOrEmpty(job.Protections)
	passMetricsJSON := marshalOrEmpty(job.PassMetrics)
	sizeImpactJSON := marshalOrEmpty(job.SizeImpact)
	compatJSON := marshalOrEmpty(job.CompatibilityReport)
	scoreJSON := marshalOrEmpty(job.StrengthScore)
	retryJSON := marshalOrEmpty(job.RetrySuggestions)
	pipe := q.client.Pipeline()
	pipe.HSet(ctx, key, "id", job.ID, "user_id", job.UserID, "input_key", job.InputKey,
		"tier", job.Tier, "binary_type", job.BinaryType, "status", "queued", "progress", 0,
		"low_entropy", boolToString(job.LowEntropy), "polymorphic_mode", boolToString(job.Polymorphic),
		"protections", protectionsJSON, "pass_metrics", passMetricsJSON, "size_impact", sizeImpactJSON,
		"compatibility_report", compatJSON, "strength_score", scoreJSON, "retry_suggestions", retryJSON)
	pipe.Expire(ctx, key, time.Duration(JobTTL)*time.Second)
	pipe.LPush(ctx, userJobsKey, job.ID)
	pipe.Expire(ctx, userJobsKey, time.Duration(JobTTL)*time.Second)
	_, err := pipe.Exec(ctx)
	return err
}

// ListJobIDsByUser returns up to limit job IDs for the user (newest first).
func (q *Queue) ListJobIDsByUser(ctx context.Context, userID string, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 50
	}
	key := UserJobsPrefix + userID + UserJobsSuffix
	ids, err := q.client.LRange(ctx, key, 0, int64(limit-1)).Result()
	return ids, err
}

func (q *Queue) GetJob(ctx context.Context, jobID string) (*JobPayload, error) {
	key := QueuePrefix + jobID
	m, err := q.client.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	if len(m) == 0 {
		return nil, nil
	}
	return &JobPayload{
		ID:                  m["id"],
		UserID:              m["user_id"],
		InputKey:            m["input_key"],
		OutputKey:           m["output_key"],
		Tier:                m["tier"],
		BinaryType:          m["binary_type"],
		LowEntropy:          parseBool(m["low_entropy"]),
		Polymorphic:         parseBool(m["polymorphic_mode"]),
		Protections:         parseStringSliceJSON(m["protections"]),
		PassMetrics:         parsePassMetricsJSON(m["pass_metrics"]),
		SizeImpact:          parseSizeImpactJSON(m["size_impact"]),
		CompatibilityReport: parseCompatibilityReportJSON(m["compatibility_report"]),
		StrengthScore:       parseStrengthScoreJSON(m["strength_score"]),
		RetrySuggestions:    parseRetrySuggestionsJSON(m["retry_suggestions"]),
		Status:              m["status"],
		Progress:            parseInt(m["progress"]),
		Error:               m["error"],
	}, nil
}

func (q *Queue) SetPassMetrics(ctx context.Context, jobID string, passMetrics []PassMetric) error {
	key := QueuePrefix + jobID
	return q.client.HSet(ctx, key, "pass_metrics", marshalOrEmpty(passMetrics)).Err()
}

func (q *Queue) SetSizeImpact(ctx context.Context, jobID string, sizeImpact *SizeImpact) error {
	key := QueuePrefix + jobID
	return q.client.HSet(ctx, key, "size_impact", marshalOrEmpty(sizeImpact)).Err()
}

func (q *Queue) SetCompatibilityReport(ctx context.Context, jobID string, report *CompatibilityReport) error {
	key := QueuePrefix + jobID
	return q.client.HSet(ctx, key, "compatibility_report", marshalOrEmpty(report)).Err()
}

func (q *Queue) SetStrengthScore(ctx context.Context, jobID string, score *StrengthScore) error {
	key := QueuePrefix + jobID
	return q.client.HSet(ctx, key, "strength_score", marshalOrEmpty(score)).Err()
}

func (q *Queue) SetRetrySuggestions(ctx context.Context, jobID string, suggestions []RetrySuggestion) error {
	key := QueuePrefix + jobID
	return q.client.HSet(ctx, key, "retry_suggestions", marshalOrEmpty(suggestions)).Err()
}

func parseInt(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func parseBool(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

func boolToString(v bool) string {
	if v {
		return "1"
	}
	return "0"
}

func parseStringSliceJSON(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return out
}

func parsePassMetricsJSON(s string) []PassMetric {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var out []PassMetric
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return out
}

func parseSizeImpactJSON(s string) *SizeImpact {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var out SizeImpact
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return &out
}

func parseCompatibilityReportJSON(s string) *CompatibilityReport {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var out CompatibilityReport
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return &out
}

func parseStrengthScoreJSON(s string) *StrengthScore {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var out StrengthScore
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return &out
}

func parseRetrySuggestionsJSON(s string) []RetrySuggestion {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var out []RetrySuggestion
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return out
}

func marshalOrEmpty(v interface{}) string {
	if v == nil {
		return "{}"
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Slice && rv.IsNil() {
		return "[]"
	}
	if rv.Kind() == reflect.Ptr && rv.IsNil() {
		return "{}"
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 {
		return "{}"
	}
	return string(b)
}

// DeleteJob removes a job from Redis (hash + user list). Returns the job before deletion for storage cleanup.
func (q *Queue) DeleteJob(ctx context.Context, jobID string) (*JobPayload, error) {
	job, err := q.GetJob(ctx, jobID)
	if err != nil || job == nil {
		return nil, err
	}
	key := QueuePrefix + jobID
	userJobsKey := UserJobsPrefix + job.UserID + UserJobsSuffix
	pipe := q.client.Pipeline()
	pipe.Del(ctx, key)
	pipe.LRem(ctx, userJobsKey, 0, jobID)
	_, err = pipe.Exec(ctx)
	return job, err
}

// DeleteAllJobsByUser removes all job IDs from the user's list and deletes all job hashes.
func (q *Queue) DeleteAllJobsByUser(ctx context.Context, userID string) ([]*JobPayload, error) {
	ids, err := q.ListJobIDsByUser(ctx, userID, 500)
	if err != nil {
		return nil, err
	}
	var jobs []*JobPayload
	pipe := q.client.Pipeline()
	for _, id := range ids {
		job, _ := q.GetJob(ctx, id)
		if job != nil {
			jobs = append(jobs, job)
			pipe.Del(ctx, QueuePrefix+id)
		}
	}
	userJobsKey := UserJobsPrefix + userID + UserJobsSuffix
	pipe.Del(ctx, userJobsKey)
	_, err = pipe.Exec(ctx)
	return jobs, err
}

func (q *Queue) Close() error {
	return q.client.Close()
}
