package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/shieldbinary/backend/internal/config"
	"github.com/shieldbinary/backend/internal/worker"
	"go.uber.org/zap"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	// #region agent log
	debugLog("baseline", "H2", "cmd/worker/main.go:24", "worker config loaded", map[string]interface{}{
		"redisAddr":  cfg.RedisAddr,
		"enginePath": cfg.EnginePath,
	})
	// #endregion

	logger, err := zap.NewProduction()
	if err != nil {
		log.Fatalf("logger: %v", err)
	}
	defer logger.Sync()

	w, err := worker.New(cfg, logger)
	if err != nil {
		// #region agent log
		debugLog("baseline", "H2", "cmd/worker/main.go:38", "worker init failed", map[string]interface{}{
			"redisAddr": cfg.RedisAddr,
			"error":     err.Error(),
		})
		// #endregion
		logger.Fatal("worker init failed", zap.Error(err))
	}
	defer w.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sig
		logger.Info("shutdown signal received")
		cancel()
	}()

	logger.Info("worker started, processing jobs")
	// #region agent log
	debugLog("baseline", "H3", "cmd/worker/main.go:59", "worker run loop started", map[string]interface{}{})
	// #endregion
	if err := w.Run(ctx); err != nil && err != context.Canceled {
		logger.Fatal("worker failed", zap.Error(err))
	}
	logger.Info("worker stopped")
}

func debugLog(runID, hypothesisID, location, message string, data map[string]interface{}) {
	f, err := os.OpenFile("c:\\Users\\Ryzen3D\\BinaryProtect\\.cursor\\debug.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_ = json.NewEncoder(f).Encode(map[string]interface{}{
		"id":           fmt.Sprintf("log_%d_worker", time.Now().UnixNano()),
		"timestamp":    time.Now().UnixMilli(),
		"runId":        runID,
		"hypothesisId": hypothesisID,
		"location":     location,
		"message":      message,
		"data":         data,
	})
}
