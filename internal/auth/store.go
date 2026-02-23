package auth

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

// Store handles user persistence.
type Store struct {
	db *sql.DB
}

// NewStore opens the SQLite database and ensures the users table exists.
func NewStore(dbPath string) (*Store, error) {
	if dbPath == "" {
		dbPath = "./shieldbinary.db"
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
	`)
	return err
}

// Create inserts a new user. Returns ErrEmailExists if email is taken.
func (s *Store) Create(user *User) error {
	_, err := s.db.Exec(
		`INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))`,
		user.ID, user.Email, user.PasswordHash,
	)
	if err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "unique constraint failed: users.email") ||
			strings.Contains(msg, "constraint failed: unique constraint failed: users.email") {
			return ErrEmailExists
		}
	}
	return err
}

// GetByEmail returns the user with the given email, or nil if not found.
func (s *Store) GetByEmail(email string) (*User, error) {
	var u User
	err := s.db.QueryRow(
		`SELECT id, email, password_hash, created_at FROM users WHERE email = ?`,
		email,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetByID returns the user with the given ID, or nil if not found.
func (s *Store) GetByID(id string) (*User, error) {
	var u User
	err := s.db.QueryRow(
		`SELECT id, email, password_hash, created_at FROM users WHERE id = ?`,
		id,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}
