package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/shieldbinary/backend/internal/config"
	"github.com/shieldbinary/backend/internal/worker"
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

	w, err := worker.New(cfg, logger)
	if err != nil {
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
	if err := w.Run(ctx); err != nil && err != context.Canceled {
		logger.Fatal("worker failed", zap.Error(err))
	}
	logger.Info("worker stopped")
}
