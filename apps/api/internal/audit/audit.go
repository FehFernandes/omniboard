// Package audit records sensitive events in an append-only trail
// (models.AuditLog). Recording is best-effort: it never makes the user's request
// fail — if the insert errors out, it only logs at Error level.
package audit

import (
	"encoding/json"
	"log/slog"

	"github.com/cachyosso/omniboard/internal/models"
	"gorm.io/gorm"
)

// Standardized actions. Use constants to avoid loose, divergent strings.
const (
	ActionLogin             = "auth.login"
	ActionTwoFactorEnabled  = "2fa.enabled"
	ActionTwoFactorDisabled = "2fa.disabled"
)

// Record inserts an audit event (best-effort). It guarantees valid JSON metadata
// ("{}" when empty) — the column is jsonb.
func Record(db *gorm.DB, e models.AuditLog) {
	if e.Metadata == "" {
		e.Metadata = "{}"
	}
	if err := db.Create(&e).Error; err != nil {
		slog.Error("audit: could not record the event", "action", e.Action, "err", err)
	}
}

// Meta serializes a map to JSON (string). On error/empty, it returns "{}".
func Meta(m map[string]any) string {
	if len(m) == 0 {
		return "{}"
	}
	b, err := json.Marshal(m)
	if err != nil {
		return "{}"
	}
	return string(b)
}
