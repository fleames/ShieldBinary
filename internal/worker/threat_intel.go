package worker

import (
	"context"
	"time"

	"github.com/shieldbinary/backend/internal/threatintel"
	"go.uber.org/zap"
)

func (w *Worker) runThreatIntelPoller(ctx context.Context) {
	if w.intelStore == nil || w.intelClient == nil {
		return
	}
	interval := time.Duration(w.cfg.ThreatIntelPollIntervalSec) * time.Second
	if interval <= 0 {
		interval = 30 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.pollThreatIntelOnce()
		}
	}
}

func (w *Worker) pollThreatIntelOnce() {
	if w.intelStore == nil || w.intelClient == nil {
		return
	}
	samples, err := w.intelStore.ListPendingSamples(30)
	if err != nil {
		w.logger.Warn("threat intel: list pending samples failed", zap.Error(err))
		return
	}
	for _, sample := range samples {
		if sample.ProviderSubmissionID == "" {
			continue
		}
		info, err := w.intelClient.GetAnalysis(sample.ProviderSubmissionID)
		if err != nil {
			_ = w.intelStore.SetSampleStatus(sample.JobID, "pending", err.Error())
			continue
		}
		status := info.AnalysisStatus
		if status == "" {
			status = "pending"
		}
		if status == "completed" {
			_ = w.intelStore.UpsertResult(threatintel.ResultRecord{
				SampleSHA256:   sample.SampleSHA256,
				Provider:       sample.Provider,
				AnalysisStatus: "completed",
				DetectedCount:  info.DetectedCount,
				EngineCount:    info.EngineCount,
				VerdictRatio:   ratio(info.DetectedCount, info.EngineCount),
				FirstSeen:      time.Now().UTC(),
				LastSeen:       time.Now().UTC(),
				RawSummaryJSON: truncateString(info.RawSummaryJSON, 12000),
			})
			_ = w.intelStore.SetSampleStatus(sample.JobID, "completed", "")
		} else {
			_ = w.intelStore.SetSampleStatus(sample.JobID, "pending", "")
		}
	}
	if w.intelAnalyzer != nil {
		if err := w.intelAnalyzer.Run(time.Now().UTC()); err != nil {
			w.logger.Warn("threat intel: analyzer run failed", zap.Error(err))
		}
	}
}

func ratio(num, den int) float64 {
	if den <= 0 {
		return 0
	}
	return float64(num) / float64(den)
}

func truncateString(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max]
}
