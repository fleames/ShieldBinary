package main

import (
	"fmt"
	"log"

	"github.com/shieldbinary/backend/internal/api"
	"github.com/shieldbinary/backend/internal/auth"
	"github.com/shieldbinary/backend/internal/config"
	"github.com/shieldbinary/backend/internal/queue"
	"github.com/shieldbinary/backend/internal/ratelimit"
	"github.com/shieldbinary/backend/internal/storage"
	"go.uber.org/zap"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	logger, err := zap.NewProduction()
	if err != nil {
		log.Fatalf("logger: %v", err)
	}
	defer logger.Sync()

	store, err := storage.NewFromConfig(cfg)
	if err != nil {
		log.Fatalf("storage: %v", err)
	}

	authStore, err := auth.NewStore(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("auth store: %v", err)
	}
	defer authStore.Close()

	q, err := queue.New(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err != nil {
		log.Fatalf("queue: %v", err)
	}
	defer q.Close()

	rl, err := ratelimit.New(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	if err != nil {
		log.Fatalf("ratelimit: %v", err)
	}
	defer rl.Close()

	srv := api.NewServer(cfg, logger, store, q, authStore, rl)
	addr := fmt.Sprintf(":%d", cfg.HTTPPort)
	logger.Info("starting API server", zap.String("addr", addr))

	if err := srv.Run(addr); err != nil {
		logger.Fatal("server failed", zap.Error(err))
	}
}
