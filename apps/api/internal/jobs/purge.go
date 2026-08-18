// Package jobs contains maintenance tasks that run in background alongside the
// server (housekeeping), such as purging expired records.
package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/FehFernandes/omniboard/internal/models"
	"gorm.io/gorm"
)

// revokedGrace is how long a revoked session is kept before being removed.
// Keeping it for a while preserves a trail for debugging/detecting recent
// reuse; after that it has no more value and only takes up space.
const revokedGrace = 24 * time.Hour

// StartPurge fires a periodic job that removes (hard delete) sessions and
// verification_tokens that are no longer useful:
//   - sessions expired, or revoked more than revokedGrace ago;
//   - verification_tokens expired or already used.
//
// Runs once at boot and then every `interval`. Returns a stop function that
// must be called on graceful shutdown (terminates the goroutine).
//
// The tables use soft delete (BaseModel.DeletedAt); that is why we use
// Unscoped() to really free space, instead of just marking deleted_at.
func StartPurge(db *gorm.DB, interval time.Duration) (stop func()) {
	if interval <= 0 {
		interval = time.Hour
	}
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		PurgeOnce(db) // clean up right at boot
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				PurgeOnce(db)
			}
		}
	}()

	return cancel
}

// PurgeOnce runs one cleanup pass. Exported to allow running on demand
// (e.g.: a maintenance command or a test).
func PurgeOnce(db *gorm.DB) {
	now := time.Now()

	sessions := db.Unscoped().
		Where("expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)", now, now.Add(-revokedGrace)).
		Delete(&models.Session{})
	if sessions.Error != nil {
		slog.Warn("purge: could not clean sessions", "err", sessions.Error)
	}

	tokens := db.Unscoped().
		Where("expires_at < ? OR used_at IS NOT NULL", now).
		Delete(&models.VerificationToken{})
	if tokens.Error != nil {
		slog.Warn("purge: could not clean verification_tokens", "err", tokens.Error)
	}

	slog.Info("purge finished",
		"sessions_removidas", sessions.RowsAffected,
		"tokens_removidos", tokens.RowsAffected,
	)
}
