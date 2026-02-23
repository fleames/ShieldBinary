package storage

import (
	"github.com/shieldbinary/backend/internal/config"
)

// NewFromConfig returns Storage based on config. Uses S3 when credentials set, else local.
func NewFromConfig(cfg *config.Config) (Storage, error) {
	if cfg.StorageAccessKey != "" && cfg.StorageSecretKey != "" && cfg.StorageEndpoint != "" {
		return NewS3(
			cfg.StorageEndpoint,
			cfg.StorageBucket,
			cfg.StorageAccessKey,
			cfg.StorageSecretKey,
			cfg.StorageUseSSL,
		)
	}
	return NewLocal(cfg.StorageLocalPath)
}
