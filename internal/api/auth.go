package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type claims struct {
	UserID   string `json:"uid"`
	Email    string `json:"email"`
	jwt.RegisteredClaims
}

func (s *Server) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		auth := c.GetHeader("Authorization")
		if s.cfg.JWTSecret == "" {
			// Development: no auth required
			c.Set("user_id", "dev-user")
			c.Set("email", "dev@shieldbinary.local")
			c.Next()
			return
		}
		if auth == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing Authorization header"})
			c.Abort()
			return
		}
		parts := strings.SplitN(auth, " ", 2)
		if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid Authorization format"})
			c.Abort()
			return
		}
		tokenStr := parts[1]

		var cl claims
		token, err := jwt.ParseWithClaims(tokenStr, &cl, func(t *jwt.Token) (interface{}, error) {
			return []byte(s.cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			c.Abort()
			return
		}
		c.Set("user_id", cl.UserID)
		c.Set("email", cl.Email)
		c.Next()
	}
}
