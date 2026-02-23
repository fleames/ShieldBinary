package api

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shieldbinary/backend/internal/auth"
	"github.com/shieldbinary/backend/internal/queue"
	"github.com/shieldbinary/backend/internal/scanner"
	"go.uber.org/zap"
)

const maxUploadSize = 100 << 20 // 100 MB

var validTiers = map[string]bool{"minimal": true, "basic": true, "pro": true, "enterprise": true}
var validProtections = map[string]bool{
	"resource_encryption":        true,
	"reference_proxy":            true,
	"delegate_proxy":             true,
	"reflection_dispatch":        true,
	"type_scramble":              true,
	"assembly_embed":             true,
	"anti_decompiler":            true,
	"anti_decompiler_aggressive": true,
	"invalid_metadata":           true,
	"method_body_encryption":     true,
	"dynamic_method_generation":  true,
	"runtime_rasp":               true,
	"local_var_promotion":        true,
	"il_mutation":                true,
	"rename_mode_random":         true,
	"rename_mode_sequential":     true,
	"rename_mode_unicode":        true,
	"rename_mode_unprintable":    true,
	"polymorphic_mode":           true,
}

func (s *Server) handleRegister(c *gin.Context) {
	if s.authStore == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth not configured"})
		return
	}
	if s.rateLimiter != nil && s.cfg.RateLimitAuthPer15Min > 0 {
		allowed, _, err := s.rateLimiter.AllowAuth(c.Request.Context(), c.ClientIP(), s.cfg.RateLimitAuthPer15Min, 15*time.Minute)
		if err != nil {
			s.logger.Warn("rate limit check failed", zap.Error(err))
		} else if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many attempts, try again later"})
			return
		}
	}
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user, err := auth.NewUser(req.Email, req.Password)
	if err != nil {
		s.logger.Error("create user failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "registration failed"})
		return
	}
	if err := s.authStore.Create(user); err != nil {
		if err == auth.ErrEmailExists {
			c.JSON(http.StatusConflict, gin.H{"error": "email already registered"})
			return
		}
		s.logger.Error("store user failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "registration failed"})
		return
	}
	token, err := s.issueToken(user.ID, user.Email)
	if err != nil {
		// Dev mode: return placeholder token when JWT secret not set
		if err == ErrNoJWTSecret {
			token = "dev"
		} else {
			s.logger.Error("issue token failed", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "registration succeeded but login failed"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  gin.H{"id": user.ID, "email": user.Email},
	})
}

func (s *Server) handleLogin(c *gin.Context) {
	if s.authStore == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "auth not configured"})
		return
	}
	if s.rateLimiter != nil && s.cfg.RateLimitAuthPer15Min > 0 {
		allowed, _, err := s.rateLimiter.AllowAuth(c.Request.Context(), c.ClientIP(), s.cfg.RateLimitAuthPer15Min, 15*time.Minute)
		if err != nil {
			s.logger.Warn("rate limit check failed", zap.Error(err))
		} else if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many attempts, try again later"})
			return
		}
	}
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user, err := s.authStore.GetByEmail(req.Email)
	if err != nil {
		s.logger.Error("get user failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
		return
	}
	if user == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}
	if err := user.CheckPassword(req.Password); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}
	token, err := s.issueToken(user.ID, user.Email)
	if err != nil {
		if err == ErrNoJWTSecret {
			token = "dev"
		} else {
			s.logger.Error("issue token failed", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "login failed"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  gin.H{"id": user.ID, "email": user.Email},
	})
}

func (s *Server) handleMe(c *gin.Context) {
	userID, _ := c.Get("user_id")
	email, _ := c.Get("email")
	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{"id": userID, "email": email},
	})
}

// handleUpload receives a binary file and stores it, returns input_key for job creation
func (s *Server) handleUpload(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file required"})
		return
	}
	if file.Size > maxUploadSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large (max 100MB)"})
		return
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".exe" && ext != ".dll" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only .exe and .dll allowed"})
		return
	}

	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}
	defer f.Close()

	// Validate PE magic (MZ header)
	header := make([]byte, 2)
	if _, err := io.ReadFull(f, header); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too small or unreadable"})
		return
	}
	if header[0] != 0x4D || header[1] != 0x5A {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not a valid PE file (missing MZ header)"})
		return
	}
	r := io.MultiReader(bytes.NewReader(header), f)

	userID, _ := c.Get("user_id")
	key := fmt.Sprintf("inputs/%s/%s%s", userID, uuid.New().String(), ext)

	if err := s.storage.Upload(c.Request.Context(), key, r, file.Size); err != nil {
		s.logger.Error("upload failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "upload failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"input_key": key,
		"filename":  file.Filename,
		"size":      file.Size,
	})
}

// handleScan receives a binary file, scans it (no storage), and returns scan result.
func (s *Server) handleScan(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file required"})
		return
	}
	if file.Size > maxUploadSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file too large (max 100MB)"})
		return
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	if ext != ".exe" && ext != ".dll" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only .exe and .dll allowed"})
		return
	}
	f, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file"})
		return
	}
	result := scanner.ScanBytes(file.Filename, data)
	c.JSON(http.StatusOK, result)
}

// handleCreateJob creates a protection job and enqueues it
func (s *Server) handleCreateJob(c *gin.Context) {
	var req struct {
		InputKey    string   `json:"input_key" binding:"required"`
		Tier        string   `json:"tier" binding:"required"`
		BinaryType  string   `json:"binary_type"`
		LowEntropy  bool     `json:"low_entropy"`
		Polymorphic bool     `json:"polymorphic_mode"`
		Protections []string `json:"protections,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	tier := strings.ToLower(strings.TrimSpace(req.Tier))
	if !validTiers[tier] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tier must be minimal, basic, pro, or enterprise"})
		return
	}
	if req.BinaryType == "" {
		req.BinaryType = "auto"
	}
	req.Protections = sanitizeProtections(req.Protections)

	userID, _ := c.Get("user_id")
	userIDStr, _ := userID.(string)
	// Ensure input_key belongs to this user (prevents accessing others' uploads)
	if !strings.HasPrefix(req.InputKey, "inputs/"+userIDStr+"/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid input_key"})
		return
	}
	if s.rateLimiter != nil && s.cfg.RateLimitJobsPerHour > 0 {
		allowed, remaining, err := s.rateLimiter.AllowJob(c.Request.Context(), userIDStr, s.cfg.RateLimitJobsPerHour)
		if err != nil {
			s.logger.Warn("rate limit check failed", zap.Error(err))
		} else if !allowed {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":     "job limit reached for this hour, try again later",
				"remaining": remaining,
			})
			return
		}
	}
	jobID := uuid.New().String()
	job := &queue.JobPayload{
		ID:          jobID,
		UserID:      userIDStr,
		InputKey:    req.InputKey,
		Tier:        tier,
		BinaryType:  req.BinaryType,
		LowEntropy:  req.LowEntropy,
		Polymorphic: req.Polymorphic,
		Protections: req.Protections,
	}

	ctx := c.Request.Context()
	if err := s.queue.StoreJob(ctx, job); err != nil {
		s.logger.Error("store job failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create job"})
		return
	}
	if err := s.queue.Enqueue(ctx, job); err != nil {
		s.queue.SetStatus(ctx, jobID, "failed", 0)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to queue job"})
		return
	}

	c.JSON(http.StatusAccepted, gin.H{
		"job_id":  jobID,
		"status":  "queued",
		"message": "job submitted for processing",
	})
}

// handleListJobs returns jobs for the current user.
func (s *Server) handleListJobs(c *gin.Context) {
	userIDVal, ok := c.Get("user_id")
	if !ok || userIDVal == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, ok := userIDVal.(string)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid user"})
		return
	}
	limit := 50
	if l := c.Query("limit"); l != "" {
		if n, err := parseLimit(l); err == nil && n > 0 {
			if n > 100 {
				n = 100
			}
			limit = n
		}
	}
	ids, err := s.queue.ListJobIDsByUser(c.Request.Context(), userID, limit)
	if err != nil {
		s.logger.Error("list jobs failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list jobs"})
		return
	}
	jobs := make([]gin.H, 0, len(ids))
	for _, id := range ids {
		job, err := s.queue.GetJob(c.Request.Context(), id)
		if err != nil || job == nil {
			continue
		}
		jobs = append(jobs, gin.H{
			"job_id":           job.ID,
			"status":           job.Status,
			"progress":         job.Progress,
			"tier":             job.Tier,
			"binary_type":      job.BinaryType,
			"low_entropy":      job.LowEntropy,
			"polymorphic_mode": job.Polymorphic,
			"protections":      job.Protections,
			"input_key":        job.InputKey,
			"output_key":       job.OutputKey,
			"error":            job.Error,
		})
	}
	c.JSON(http.StatusOK, gin.H{"jobs": jobs})
}

func parseLimit(s string) (int, error) {
	return strconv.Atoi(s)
}

// handleGetJob returns job status
func (s *Server) handleGetJob(c *gin.Context) {
	jobID := c.Param("id")
	if jobID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job_id required"})
		return
	}

	job, err := s.queue.GetJob(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get job"})
		return
	}
	if job == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}

	userID, _ := c.Get("user_id")
	if job.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"job_id":           job.ID,
		"status":           job.Status,
		"progress":         job.Progress,
		"tier":             job.Tier,
		"binary_type":      job.BinaryType,
		"low_entropy":      job.LowEntropy,
		"polymorphic_mode": job.Polymorphic,
		"protections":      job.Protections,
		"input_key":        job.InputKey,
		"output_key":       job.OutputKey,
		"error":            job.Error,
	})
}

func sanitizeProtections(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, p := range in {
		k := strings.ToLower(strings.TrimSpace(p))
		if k == "" || !validProtections[k] || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, k)
	}
	return out
}

// handleDeleteJob removes a job and its storage artifacts.
func (s *Server) handleDeleteJob(c *gin.Context) {
	jobID := c.Param("id")
	if jobID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job_id required"})
		return
	}
	job, err := s.queue.DeleteJob(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete job"})
		return
	}
	if job == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	userID, _ := c.Get("user_id")
	if job.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	ctx := c.Request.Context()
	if job.InputKey != "" {
		_ = s.storage.Delete(ctx, job.InputKey)
	}
	if job.OutputKey != "" {
		_ = s.storage.Delete(ctx, job.OutputKey)
	}
	c.JSON(http.StatusOK, gin.H{"message": "job deleted"})
}

// handleDeleteAllJobs removes all jobs for the current user and their storage artifacts.
func (s *Server) handleDeleteAllJobs(c *gin.Context) {
	userIDVal, ok := c.Get("user_id")
	if !ok || userIDVal == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	userID, ok := userIDVal.(string)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid user"})
		return
	}
	jobs, err := s.queue.DeleteAllJobsByUser(c.Request.Context(), userID)
	if err != nil {
		s.logger.Error("delete all jobs failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete jobs"})
		return
	}
	ctx := c.Request.Context()
	for _, job := range jobs {
		if job.InputKey != "" {
			_ = s.storage.Delete(ctx, job.InputKey)
		}
		if job.OutputKey != "" {
			_ = s.storage.Delete(ctx, job.OutputKey)
		}
	}
	c.JSON(http.StatusOK, gin.H{"message": "all jobs deleted", "count": len(jobs)})
}

// handleDownloadJob streams the protected binary. After a successful download,
// the file is deleted from storage and output_key is cleared (single-download policy).
func (s *Server) handleDownloadJob(c *gin.Context) {
	jobID := c.Param("id")
	if jobID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job_id required"})
		return
	}

	job, err := s.queue.GetJob(c.Request.Context(), jobID)
	if err != nil || job == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	userID, _ := c.Get("user_id")
	if job.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
		return
	}
	if job.Status != "completed" || job.OutputKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job not ready for download"})
		return
	}

	ctx := c.Request.Context()
	outputKey, err := s.queue.ClaimOutputKey(ctx, jobID)
	if err != nil || outputKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "job not ready for download"})
		return
	}

	rc, err := s.storage.Download(ctx, outputKey)
	if err != nil {
		_ = s.queue.SetOutputKey(ctx, jobID, outputKey) // restore on failure
		c.JSON(http.StatusInternalServerError, gin.H{"error": "download failed"})
		return
	}
	defer rc.Close()

	ext := filepath.Ext(outputKey)
	if ext == "" {
		ext = ".dll"
	}
	c.Header("Content-Disposition", "attachment; filename=protected"+ext)
	c.Header("Content-Type", "application/octet-stream")

	if _, err := io.Copy(c.Writer, rc); err != nil {
		s.logger.Warn("download stream interrupted", zap.String("job_id", jobID), zap.Error(err))
		// output_key already cleared; restore so user can retry if stream failed
		_ = s.queue.SetOutputKey(ctx, jobID, outputKey)
		return
	}
	rc.Close() // Must close before Delete on Windows (file locked while open)

	// Single-download: delete file from storage (output_key already cleared)
	if delErr := s.storage.Delete(ctx, outputKey); delErr != nil {
		s.logger.Error("failed to delete output after download", zap.String("job_id", jobID), zap.Error(delErr))
	}
}
