package storage

import (
	"context"
	"io"
	"time"
)

// Storage abstracts binary storage (local or S3-compatible)
type Storage interface {
	Upload(ctx context.Context, key string, r io.Reader, size int64) error
	Download(ctx context.Context, key string) (io.ReadCloser, error)
	Presign(ctx context.Context, key string, expiry time.Duration) (string, error)
	Delete(ctx context.Context, key string) error
}
