package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

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
	// #region agent log
	debugLog("baseline", "H1", "cmd/api/main.go:24", "api config loaded", map[string]interface{}{
		"httpPort":  cfg.HTTPPort,
		"redisAddr": cfg.RedisAddr,
		"env":       cfg.Environment,
	})
	// #endregion

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
		// #region agent log
		debugLog("baseline", "H2", "cmd/api/main.go:48", "api queue init failed", map[string]interface{}{
			"redisAddr": cfg.RedisAddr,
			"error":     err.Error(),
		})
		// #endregion
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
	// #region agent log
	debugLog("baseline", "H1", "cmd/api/main.go:66", "api server run invoked", map[string]interface{}{
		"addr": addr,
	})
	// #endregion

	if err := srv.Run(addr); err != nil {
		logger.Fatal("server failed", zap.Error(err))
	}
}

func debugLog(runID, hypothesisID, location, message string, data map[string]interface{}) {
	f, err := os.OpenFile("c:\\Users\\Ryzen3D\\BinaryProtect\\.cursor\\debug.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_ = json.NewEncoder(f).Encode(map[string]interface{}{
		"id":           fmt.Sprintf("log_%d_api", time.Now().UnixNano()),
		"timestamp":    time.Now().UnixMilli(),
		"runId":        runID,
		"hypothesisId": hypothesisID,
		"location":     location,
		"message":      message,
		"data":         data,
	})
}
