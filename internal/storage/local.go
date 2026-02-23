package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// LocalStorage stores files on disk (for development)
type LocalStorage struct {
	root string
}

func NewLocal(root string) (*LocalStorage, error) {
	if err := os.MkdirAll(root, 0755); err != nil {
		return nil, err
	}
	return &LocalStorage{root: root}, nil
}

func (s *LocalStorage) path(key string) string {
	return filepath.Join(s.root, key)
}

func (s *LocalStorage) Upload(ctx context.Context, key string, r io.Reader, size int64) error {
	full := s.path(key)
	if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
		return err
	}
	f, err := os.Create(full)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}

func (s *LocalStorage) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	f, err := os.Open(s.path(key))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("key not found: %s", key)
		}
		return nil, err
	}
	return f, nil
}

func (s *LocalStorage) Presign(ctx context.Context, key string, expiry time.Duration) (string, error) {
	// Local storage has no presigned URLs - return file path for dev (not secure)
	return "file://" + s.path(key), nil
}

func (s *LocalStorage) Delete(ctx context.Context, key string) error {
	return os.Remove(s.path(key))
}
