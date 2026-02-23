package api

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shieldbinary/backend/internal/queue"
	"github.com/shieldbinary/backend/internal/threatintel"
)

func (s *Server) handleThreatIntelSubmit(c *gin.Context) {
	if !s.cfg.EnableThreatIntel || s.intelStore == nil || s.intelClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "threat intelligence is not enabled"})
		return
	}
	jobID := strings.TrimSpace(c.Param("id"))
	if jobID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job_id required"})
		return
	}
	job, err := s.queue.GetJob(c.Request.Context(), jobID)
	if err != nil || job == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	userIDVal, _ := c.Get("user_id")
	userID, _ := userIDVal.(string)
	if userID == "" || job.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	if job.Status != "completed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job must be completed before threat-intel submission"})
		return
	}
	if existing, _ := s.intelStore.GetSampleByJobID(jobID); existing != nil {
		c.JSON(http.StatusOK, gin.H{
			"job_id":      existing.JobID,
			"submitted":   true,
			"status":      existing.Status,
			"sample_hash": existing.SampleSHA256,
			"provider":    existing.Provider,
		})
		return
	}
	if strings.TrimSpace(job.OutputKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "protected output is no longer available for submission"})
		return
	}
	rc, err := s.storage.Download(c.Request.Context(), job.OutputKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read protected output"})
		return
	}
	defer rc.Close()
	maxBytes := s.cfg.ThreatIntelMaxSampleBytes
	if maxBytes <= 0 {
		maxBytes = 30 * 1024 * 1024
	}
	payload, err := io.ReadAll(io.LimitReader(rc, maxBytes+1))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read protected output"})
		return
	}
	if int64(len(payload)) > maxBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sample exceeds threat-intel size limit"})
		return
	}
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])

	provider := strings.ToLower(strings.TrimSpace(s.cfg.ThreatIntelProvider))
	if provider == "" {
		provider = "virustotal"
	}
	passes := passNamesFromJob(job.PassMetrics)

	rec := threatintel.SampleRecord{
		JobID:           job.ID,
		UserID:          job.UserID,
		SampleSHA256:    hash,
		Provider:        provider,
		SubmitMode:      "manual",
		Status:          "submitted",
		SubmittedAt:     time.Now().UTC(),
		Tier:            job.Tier,
		LowEntropy:      job.LowEntropy,
		PolymorphicMode: job.Polymorphic,
		Protections:     job.Protections,
		Passes:          passes,
	}

	// Manual submit now always performs an explicit provider upload.
	// We keep the SHA256 for local tracking, but do not short-circuit on hash lookup.
	submitted, err := s.intelClient.SubmitFile("protected-"+job.ID, payload)
	if err != nil {
		rec.Status = "failed"
		rec.LastError = err.Error()
		_ = s.intelStore.UpsertSample(rec)
		c.JSON(http.StatusBadGateway, gin.H{"error": "threat-intel submission failed"})
		return
	}
	if submitted != nil {
		rec.ProviderSubmissionID = submitted.ProviderID
		rec.Status = submitted.AnalysisStatus
		if rec.Status == "completed" {
			_ = s.intelStore.UpsertResult(threatintel.ResultRecord{
				SampleSHA256:   hash,
				Provider:       provider,
				AnalysisStatus: "completed",
				DetectedCount:  submitted.DetectedCount,
				EngineCount:    submitted.EngineCount,
				VerdictRatio:   ratio(submitted.DetectedCount, submitted.EngineCount),
				FirstSeen:      time.Now().UTC(),
				LastSeen:       time.Now().UTC(),
				RawSummaryJSON: truncateString(submitted.RawSummaryJSON, 12000),
			})
		}
	}
	if err := s.intelStore.UpsertSample(rec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store threat-intel submission"})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{
		"job_id":              job.ID,
		"submitted":           true,
		"status":              rec.Status,
		"sample_hash":         hash,
		"provider":            provider,
		"provider_submission": rec.ProviderSubmissionID,
	})
}

func (s *Server) handleThreatIntelStatus(c *gin.Context) {
	if !s.cfg.EnableThreatIntel || s.intelStore == nil {
		c.JSON(http.StatusOK, gin.H{"enabled": false})
		return
	}
	jobID := strings.TrimSpace(c.Param("id"))
	if jobID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job_id required"})
		return
	}
	job, err := s.queue.GetJob(c.Request.Context(), jobID)
	if err != nil || job == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	userIDVal, _ := c.Get("user_id")
	userID, _ := userIDVal.(string)
	if userID == "" || job.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	rec, err := s.intelStore.GetSampleByJobID(jobID)
	if err != nil || rec == nil {
		c.JSON(http.StatusOK, gin.H{"enabled": true, "submitted": false})
		return
	}
	result, _ := s.intelStore.GetResult(rec.SampleSHA256, rec.Provider)
	resp := gin.H{
		"enabled":             true,
		"submitted":           true,
		"job_id":              rec.JobID,
		"sample_hash":         rec.SampleSHA256,
		"status":              rec.Status,
		"provider":            rec.Provider,
		"provider_submission": rec.ProviderSubmissionID,
		"submitted_at":        rec.SubmittedAt,
		"last_error":          rec.LastError,
	}
	if result != nil {
		resp["detected_count"] = result.DetectedCount
		resp["engine_count"] = result.EngineCount
		resp["verdict_ratio"] = result.VerdictRatio
		resp["analysis_status"] = result.AnalysisStatus
		resp["last_seen"] = result.LastSeen
	}
	c.JSON(http.StatusOK, resp)
}

func (s *Server) handleThreatIntelFlags(c *gin.Context) {
	if !s.cfg.EnableThreatIntel || s.intelStore == nil {
		c.JSON(http.StatusOK, gin.H{"enabled": false, "flags": []threatintel.TechniqueFlag{}})
		return
	}
	limit := 50
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	flags, err := s.intelStore.ListTechniqueFlags(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list threat-intel flags"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"enabled": true, "flags": flags})
}

func passNamesFromJob(passMetrics []queue.PassMetric) []string {
	set := map[string]bool{}
	var out []string
	for _, p := range passMetrics {
		name := strings.ToLower(strings.TrimSpace(p.Name))
		if name == "" || set[name] {
			continue
		}
		set[name] = true
		out = append(out, name)
	}
	return out
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
