package auth

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

var ErrEmailExists = errors.New("email already registered")

type User struct {
	ID           string
	Email        string
	PasswordHash string
	CreatedAt    string
}

// NewUser creates a user with a hashed password.
func NewUser(email, password string) (*User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	return &User{
		ID:           uuid.New().String(),
		Email:        email,
		PasswordHash: string(hash),
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// CheckPassword returns nil if the password matches.
func (u *User) CheckPassword(password string) error {
	return bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password))
}
