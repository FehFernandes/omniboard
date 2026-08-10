package jobs_test

import (
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/cachyosso/omniboard/internal/models"
)

// Database for the job tests. It uses the same test Postgres as the other
// packages (DB_* variables), and skips when it is not available — that way the
// package does not break the suite of someone who only wants the pure tests.
func newDB(t *testing.T) *gorm.DB {
	t.Helper()

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		env("DB_HOST", "localhost"), env("DB_PORT", "5434"),
		env("DB_USER", "postgres"), env("DB_PASSWORD", "postgres"),
		env("DB_NAME", "omniboard_test"), env("DB_SSLMODE", "disable"),
	)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Skipf("test database unavailable: %v", err)
	}
	require.NoError(t, db.AutoMigrate(&models.Workspace{}))
	// Each test starts with no workspaces (the sweep scans them all).
	require.NoError(t, db.Unscoped().Where("1 = 1").Delete(&models.Workspace{}).Error)
	return db
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

/** Creates a user's workspace with the given content. */
func inserirWorkspace(t *testing.T, db *gorm.DB, userID string, payload datatypes.JSON) {
	t.Helper()
	ws := models.Workspace{
		UserID:  userID,
		Data:    payload,
		Version: 1,
	}
	ws.CreatedAt = time.Now()
	require.NoError(t, db.Create(&ws).Error)
}
