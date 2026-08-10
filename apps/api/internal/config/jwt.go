package config

import (
	"log"
	"os"
	"strconv"
	"time"
)

// JWTConfig holds the JWT token settings.
type JWTConfig struct {
	SecretKey             string
	RefreshSecretKey      string
	AccessExpirationTime  time.Duration
	RefreshExpirationTime time.Duration
}

// minSecretLen is the minimum length (in bytes) required for the JWT secrets in
// production. 32 bytes ~ 256 bits, compatible with HMAC-SHA256.
const minSecretLen = 32

// LoadJWTConfig loads the JWT config from the environment.
// The keys are mandatory — the server stops if they are not defined.
func LoadJWTConfig() *JWTConfig {
	secret := os.Getenv("JWT_SECRET_KEY")
	if secret == "" {
		log.Fatal("FATAL: JWT_SECRET_KEY is not set.")
	}
	refresh := os.Getenv("JWT_REFRESH_SECRET_KEY")
	if refresh == "" {
		log.Fatal("FATAL: JWT_REFRESH_SECRET_KEY is not set.")
	}

	// In production, require strong secrets, distinct from each other.
	if IsProduction() {
		if len(secret) < minSecretLen || len(refresh) < minSecretLen {
			log.Fatalf("FATAL: weak JWT secrets. Use at least %d characters (e.g. openssl rand -base64 32).", minSecretLen)
		}
		if secret == refresh {
			log.Fatal("FATAL: JWT_SECRET_KEY e JWT_REFRESH_SECRET_KEY devem ser diferentes.")
		}
	}

	accessMin := 15
	if v := os.Getenv("JWT_ACCESS_EXPIRATION_MINUTES"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			accessMin = p
		}
	}
	refreshDays := 30
	if v := os.Getenv("JWT_REFRESH_EXPIRATION_DAYS"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			refreshDays = p
		}
	}

	return &JWTConfig{
		SecretKey:             secret,
		RefreshSecretKey:      refresh,
		AccessExpirationTime:  time.Minute * time.Duration(accessMin),
		RefreshExpirationTime: time.Hour * 24 * time.Duration(refreshDays),
	}
}
