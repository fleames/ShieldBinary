package config

import (
	"fmt"
	"os"
	"strconv"

	"github.com/spf13/viper"
)

type Config struct {
	Environment string `mapstructure:"environment"`
	HTTPPort    int    `mapstructure:"http_port"`

	// Redis (job queue)
	RedisAddr     string `mapstructure:"redis_addr"`
	RedisPassword string `mapstructure:"redis_password"`
	RedisDB       int    `mapstructure:"redis_db"`

	// Storage (S3-compatible, e.g. Hetzner Object Storage)
	StorageEndpoint        string `mapstructure:"storage_endpoint"`
	StorageBucket          string `mapstructure:"storage_bucket"`
	StorageAccessKey       string `mapstructure:"storage_access_key"`
	StorageSecretKey       string `mapstructure:"storage_secret_key"`
	StorageUseSSL          bool   `mapstructure:"storage_use_ssl"`
	StoragePresignedExpiry int    `mapstructure:"storage_presigned_expiry"` // minutes
	StorageLocalPath       string `mapstructure:"storage_local_path"`       // for dev: ./storage

	// .NET protection engine path (subprocess)
	EnginePath string `mapstructure:"engine_path"`
	// EngineSafePro: when true, Pro tier uses minimal pass set (Basic + AntiILDASMPass) for stability
	EngineSafePro bool `mapstructure:"engine_safe_pro"`
	// EngineVirtualization: when false, Enterprise tier skips IL virtualization (VMProtect-style)
	EngineVirtualization bool `mapstructure:"engine_virtualization"`
	// EngineLowEntropy: when true, uses deterministic encoding to reduce output file entropy
	EngineLowEntropy bool `mapstructure:"engine_low_entropy"`

	// Native PE loader stub path (for packing native binaries)
	NativeLoaderPath string `mapstructure:"native_loader_path"`

	// Auth
	JWTSecret     string `mapstructure:"jwt_secret"`
	JWTExpireMins int    `mapstructure:"jwt_expire_mins"`
	DatabasePath  string `mapstructure:"database_path"`

	// Web (static frontend)
	WebRoot string `mapstructure:"web_root"`

	// Rate limiting (0 = disabled)
	RateLimitJobsPerHour    int `mapstructure:"rate_limit_jobs_per_hour"`
	RateLimitAuthPer15Min   int `mapstructure:"rate_limit_auth_per_15min"`

	// CORS allowed origins (comma-separated; empty = same-origin only, "*" = allow all)
	CORSOrigins string `mapstructure:"cors_origins"`
}

func Load() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")
	viper.AddConfigPath("../config")

	viper.SetEnvPrefix("SHIELD")
	viper.AutomaticEnv()

	viper.SetDefault("environment", "development")
	viper.SetDefault("http_port", 8080)
	viper.SetDefault("redis_addr", "localhost:6379")
	viper.SetDefault("redis_db", 0)
	viper.SetDefault("storage_use_ssl", true)
	viper.SetDefault("storage_presigned_expiry", 60)
	viper.SetDefault("storage_local_path", "./storage")
	viper.SetDefault("storage_bucket", "shieldbinary")
	viper.SetDefault("jwt_expire_mins", 1440) // 24h
	viper.SetDefault("database_path", "./shieldbinary.db")
	viper.SetDefault("rate_limit_jobs_per_hour", 100)
	viper.SetDefault("rate_limit_auth_per_15min", 10)
	viper.SetDefault("cors_origins", "")       // empty = same-origin only; set "*" for dev or "https://app.example.com" for prod
	viper.SetDefault("engine_safe_pro", false)       // Pro tier: use minimal pass set (Basic + AntiILDASMPass) for stability
	viper.SetDefault("engine_virtualization", true)  // Enterprise tier: IL virtualization (VMProtect-style); set false to disable
	viper.SetDefault("engine_low_entropy", false)    // Use deterministic encoding to lower output entropy

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("config: %w", err)
		}
		// Config file optional; env/defaults suffice
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("config unmarshal: %w", err)
	}

	// Override from env for secrets (12-factor)
	if v := os.Getenv("SHIELD_REDIS_PASSWORD"); v != "" {
		cfg.RedisPassword = v
	}
	if v := os.Getenv("SHIELD_STORAGE_ACCESS_KEY"); v != "" {
		cfg.StorageAccessKey = v
	}
	if v := os.Getenv("SHIELD_STORAGE_SECRET_KEY"); v != "" {
		cfg.StorageSecretKey = v
	}
	if v := os.Getenv("SHIELD_JWT_SECRET"); v != "" {
		cfg.JWTSecret = v
	}
	if v := os.Getenv("SHIELD_ENGINE_PATH"); v != "" {
		cfg.EnginePath = v
	}
	if v := os.Getenv("SHIELD_NATIVE_LOADER_PATH"); v != "" {
		cfg.NativeLoaderPath = v
	}
	if v := os.Getenv("SHIELD_WEB_ROOT"); v != "" {
		cfg.WebRoot = v
	}
	if v := os.Getenv("SHIELD_CORS_ORIGINS"); v != "" {
		cfg.CORSOrigins = v
	}
	if v := os.Getenv("SHIELD_RATE_LIMIT_JOBS_PER_HOUR"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.RateLimitJobsPerHour = n // 0 = disabled
		}
	}
	if v := os.Getenv("PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.HTTPPort = p
		}
	}

	return &cfg, nil
}
