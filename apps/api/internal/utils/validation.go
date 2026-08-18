package utils

import (
	"crypto/rand"
	"encoding/hex"
	"regexp"
	"strings"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

// IsValidEmail validates the format of an email.
func IsValidEmail(email string) bool {
	return emailRegex.MatchString(email)
}

// SanitizeEmail normalizes an email (trim + lowercase).
func SanitizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// SanitizeString trims surrounding whitespace.
func SanitizeString(s string) string {
	return strings.TrimSpace(s)
}

// Slugify builds a simple slug from a text.
func Slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// SecureToken generates a secure random token (hex).
func SecureToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// RandomSuffix generates a short random suffix (6 hex chars) to disambiguate slugs.
func RandomSuffix() string {
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		return "x"
	}
	return hex.EncodeToString(b)
}
