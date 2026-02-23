package queue

import (
	"context"
	"encoding/json"
	"fmt"
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
	ID          string   `json:"id"`
	UserID      string   `json:"user_id"`
	InputKey    string   `json:"input_key"`
	OutputKey   string   `json:"output_key,omitempty"`
	Tier        string   `json:"tier"`
	BinaryType  string   `json:"binary_type"`
	LowEntropy  bool     `json:"low_entropy"`
	Polymorphic bool     `json:"polymorphic_mode"`
	Protections []string `json:"protections,omitempty"`
	Status      string   `json:"status"`
	Progress    int      `json:"progress"`
	Error       string   `json:"error,omitempty"`
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
	protectionsJSON := "[]"
	if len(job.Protections) > 0 {
		if b, err := json.Marshal(job.Protections); err == nil {
			protectionsJSON = string(b)
		}
	}
	pipe := q.client.Pipeline()
	pipe.HSet(ctx, key, "id", job.ID, "user_id", job.UserID, "input_key", job.InputKey,
		"tier", job.Tier, "binary_type", job.BinaryType, "status", "queued", "progress", 0,
		"low_entropy", boolToString(job.LowEntropy), "polymorphic_mode", boolToString(job.Polymorphic), "protections", protectionsJSON)
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
		ID:          m["id"],
		UserID:      m["user_id"],
		InputKey:    m["input_key"],
		OutputKey:   m["output_key"],
		Tier:        m["tier"],
		BinaryType:  m["binary_type"],
		LowEntropy:  parseBool(m["low_entropy"]),
		Polymorphic: parseBool(m["polymorphic_mode"]),
		Protections: parseStringSliceJSON(m["protections"]),
		Status:      m["status"],
		Progress:    parseInt(m["progress"]),
		Error:       m["error"],
	}, nil
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
