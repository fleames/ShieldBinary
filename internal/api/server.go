package api

import (
	_ "embed"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/shieldbinary/backend/internal/auth"
	"github.com/shieldbinary/backend/internal/config"
	"github.com/shieldbinary/backend/internal/queue"
	"github.com/shieldbinary/backend/internal/ratelimit"
	"github.com/shieldbinary/backend/internal/storage"
	"go.uber.org/zap"
)

//go:embed openapi.yaml
var openAPISpec []byte

var swaggerUIHTML = []byte(`<!DOCTYPE html>
<html>
<head><title>ShieldBinary API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  SwaggerUIBundle({
    url: '/api/v1/openapi.yaml',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis]
  });
</script>
</body>
</html>`)

type Server struct {
	cfg        *config.Config
	logger     *zap.Logger
	router     *gin.Engine
	storage    storage.Storage
	queue      *queue.Queue
	authStore  *auth.Store
	rateLimiter *ratelimit.Limiter
}

func NewServer(cfg *config.Config, logger *zap.Logger, store storage.Storage, q *queue.Queue, authStore *auth.Store, rl *ratelimit.Limiter) *Server {
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	// Limit trusted proxies to local machine by default to avoid spoofed client IPs.
	_ = r.SetTrustedProxies([]string{"127.0.0.1", "::1"})
	r.Use(gin.Recovery())
	r.Use(securityHeadersMiddleware())
	r.Use(corsMiddleware(cfg.CORSOrigins))
	r.Use(requestLogger(logger))

	s := &Server{cfg: cfg, logger: logger, router: r, storage: store, queue: q, authStore: authStore, rateLimiter: rl}
	s.routes()
	return s
}

func (s *Server) Run(addr string) error {
	return s.router.Run(addr)
}

func securityHeadersMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Next()
	}
}

func corsMiddleware(origins string) gin.HandlerFunc {
	allowAll := origins == "*"
	originList := make(map[string]bool)
	if origins != "" && !allowAll {
		for _, o := range strings.Split(origins, ",") {
			if t := strings.TrimSpace(o); t != "" {
				originList[t] = true
			}
		}
	}
	// When empty, allow common dev origins so local frontend works without config
	if len(originList) == 0 && !allowAll {
		for _, o := range []string{"http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"} {
			originList[o] = true
		}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == "" {
			c.Next()
			return
		}
		if allowAll {
			c.Header("Access-Control-Allow-Origin", "*")
		} else if originList[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Header("Access-Control-Max-Age", "86400")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func requestLogger(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		logger.Debug("request",
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.Int("status", c.Writer.Status()),
		)
	}
}

func (s *Server) routes() {
	// Health
	s.router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	// Readiness (Redis connectivity)
	s.router.GET("/ready", func(c *gin.Context) {
		if err := s.queue.Ping(c.Request.Context()); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy", "error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// OpenAPI spec (embedded)
	s.router.GET("/api/v1/openapi.yaml", func(c *gin.Context) {
		c.Header("Content-Type", "application/yaml")
		c.Data(http.StatusOK, "application/yaml", openAPISpec)
	})

	// Swagger UI
	s.router.GET("/api/v1/docs", func(c *gin.Context) {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Data(http.StatusOK, "text/html; charset=utf-8", swaggerUIHTML)
	})

	// Static frontend (when WebRoot set, e.g. in Docker)
	if s.cfg.WebRoot != "" {
		s.router.Static("/assets", s.cfg.WebRoot+"/assets")
		s.router.NoRoute(func(c *gin.Context) {
			if len(c.Request.URL.Path) >= 4 && c.Request.URL.Path[:4] == "/api" {
				c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
				return
			}
			c.File(s.cfg.WebRoot + "/index.html")
		})
	}

	// API v1
	v1 := s.router.Group("/api/v1")
	{
		// Public
		v1.POST("/auth/register", s.handleRegister)
		v1.POST("/auth/login", s.handleLogin)

		// Protected (requires valid token when JWT_SECRET is set)
		v1.GET("/auth/me", s.authMiddleware(), s.handleMe)

		// Protected
		protected := v1.Group("")
		protected.Use(s.authMiddleware())
		{
			protected.POST("/upload", s.handleUpload)
			protected.POST("/scan", s.handleScan)
			protected.POST("/jobs", s.handleCreateJob)
			protected.GET("/jobs", s.handleListJobs)
			protected.DELETE("/jobs", s.handleDeleteAllJobs)
			protected.GET("/jobs/:id", s.handleGetJob)
			protected.DELETE("/jobs/:id", s.handleDeleteJob)
			protected.GET("/jobs/:id/download", s.handleDownloadJob)
		}
	}
}
