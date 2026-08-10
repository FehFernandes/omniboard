package server_test

import (
	"log"
	"os"
	"testing"

	"github.com/cachyosso/omniboard/internal/config"
	"github.com/cachyosso/omniboard/internal/server"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

var (
	app *fiber.App
	db  *gorm.DB
)

// TestMain boots the real application against a dedicated test database.
func TestMain(m *testing.M) {
	// Test environment: neither production nor development (logger off, HSTS off).
	os.Setenv("ENV", "test")
	os.Setenv("JWT_SECRET_KEY", "test-secret-key-para-integracao-0001")
	os.Setenv("JWT_REFRESH_SECRET_KEY", "test-refresh-key-para-integracao-002")
	os.Setenv("JWT_ACCESS_EXPIRATION_MINUTES", "15")
	os.Setenv("JWT_REFRESH_EXPIRATION_DAYS", "30")

	// Google login: fake credentials just to keep the flow ACTIVE in tests.
	// Nenhum teste chama o Google de verdade — as chamadas de rede acontecem
	// only in the callback, which the tests exercise through the error paths
	// (invalid state, denied consent) and through the opaque code exchange.
	os.Setenv("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
	os.Setenv("GOOGLE_CLIENT_SECRET", "test-client-secret")
	os.Setenv("GOOGLE_REDIRECT_URL", "http://localhost:4000/api/auth/google/callback")
	os.Setenv("APP_URL", "http://localhost:5173")

	// Banco de teste (sobrescreve via env se quiser).
	setDefault("DB_HOST", "localhost")
	setDefault("DB_PORT", "5434")
	setDefault("DB_USER", "postgres")
	setDefault("DB_PASSWORD", "postgres")
	setDefault("DB_NAME", "omniboard_test")
	setDefault("DB_SSLMODE", "disable")

	var err error
	db, err = config.Database()
	if err != nil {
		log.Fatalf("test: could not connect to the test database: %v", err)
	}
	// Mirrors main: versioned when DB_MIGRATE=versioned; otherwise AutoMigrate.
	if config.UseVersionedMigrations() {
		if err := config.RunMigrations(); err != nil {
			log.Fatalf("teste: versioned migrations failed: %v", err)
		}
	} else if err := config.Migrate(db); err != nil {
		log.Fatalf("teste: migrations failed: %v", err)
	}
	truncateAll()

	app = server.New(db, config.LoadJWTConfig(), config.LoadGoogleOAuth())
	os.Exit(m.Run())
}

func setDefault(k, v string) {
	if os.Getenv(k) == "" {
		os.Setenv(k, v)
	}
}

// truncateAll wipes every table between suite runs.
func truncateAll() {
	db.Exec(`TRUNCATE items, verification_tokens, sessions, users, audit_logs, two_factor_recovery_codes RESTART IDENTITY CASCADE`)
}
