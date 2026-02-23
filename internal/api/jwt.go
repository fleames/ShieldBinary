package api

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var ErrNoJWTSecret = errors.New("JWT secret not configured")

// issueToken creates a JWT for the given user.
func (s *Server) issueToken(userID, email string) (string, error) {
	if s.cfg.JWTSecret == "" {
		return "", ErrNoJWTSecret
	}
	exp := time.Duration(s.cfg.JWTExpireMins) * time.Minute
	claims := &claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(exp)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "shieldbinary",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.cfg.JWTSecret))
}

// requireAuth returns an error response if JWT secret is not set (auth required).
func (s *Server) requireAuth() bool {
	return s.cfg.JWTSecret != ""
}
