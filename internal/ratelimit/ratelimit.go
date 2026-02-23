package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const keyPrefix = "shieldbinary:ratelimit:"

// Limiter uses Redis for rate limiting (sliding window via INCR+EXPIRE).
type Limiter struct {
	client *redis.Client
}

// New creates a rate limiter using the same Redis connection params as the queue.
func New(addr, password string, db int) (*Limiter, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return &Limiter{client: client}, nil
}

func (l *Limiter) Close() error {
	return l.client.Close()
}

// AllowJob checks if the key (e.g. user ID) can create a job. Returns true if allowed.
// Uses fixed 1-hour windows: maxPerHour jobs per calendar hour.
func (l *Limiter) AllowJob(ctx context.Context, key string, maxPerHour int) (allowed bool, remaining int, err error) {
	if maxPerHour <= 0 {
		return true, -1, nil
	}
	bucket := time.Now().UTC().Format("2006-01-02-15")
	rkey := keyPrefix + "job:" + key + ":" + bucket
	return l.check(ctx, rkey, maxPerHour, 2*time.Hour)
}

// AllowAuth checks if the key (e.g. IP) can attempt login/register.
func (l *Limiter) AllowAuth(ctx context.Context, key string, maxPerWindow int, window time.Duration) (allowed bool, remaining int, err error) {
	if maxPerWindow <= 0 {
		return true, -1, nil
	}
	rkey := keyPrefix + "auth:" + key
	return l.check(ctx, rkey, maxPerWindow, window)
}

func (l *Limiter) check(ctx context.Context, rkey string, max int, window time.Duration) (allowed bool, remaining int, err error) {
	pipe := l.client.Pipeline()
	incr := pipe.Incr(ctx, rkey)
	expire := pipe.Expire(ctx, rkey, window)
	if _, err := pipe.Exec(ctx); err != nil {
		return false, 0, err
	}
	_ = expire
	n := int(incr.Val())
	if n > max {
		return false, 0, nil
	}
	return true, max - n, nil
}
