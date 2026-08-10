package handlers

import (
	"os"
	"strings"
	"time"

	"github.com/cachyosso/omniboard/internal/audit"
	"github.com/cachyosso/omniboard/internal/middleware"
	"github.com/cachyosso/omniboard/internal/models"
	"github.com/cachyosso/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

// appURL returns the frontend's base URL, without a trailing slash. Used to hand
// control back to the front end at the end of the OAuth flow. Configurable via
// APP_URL; defaults to the Vite dev server.
func appURL() string {
	if v := os.Getenv("APP_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://localhost:5173"
}

// createVerificationToken generates a single-use opaque token: it returns the RAW
// value (which goes to the client) and persists only the hash + expiration. Today
// the only purpose in use is PurposeOAuthExchange — the code the front end
// exchanges for the token pair at the end of the Google login.
func (h *AuthHandler) createVerificationToken(user *models.User, purpose string, ttl time.Duration) (string, error) {
	raw, err := utils.SecureToken()
	if err != nil {
		return "", err
	}
	vt := models.VerificationToken{
		UserID:    user.ID,
		Purpose:   purpose,
		TokenHash: utils.HashToken(raw),
		ExpiresAt: time.Now().Add(ttl),
	}
	if err := h.db.Create(&vt).Error; err != nil {
		return "", err
	}
	return raw, nil
}

// recordAudit records an audit event from the authenticated context (actor =
// user from the token). For events on public routes, build the models.AuditLog
// and call audit.Record directly.
func recordAudit(db *gorm.DB, c *fiber.Ctx, action, targetType, targetID string, meta map[string]any) {
	entry := models.AuditLog{
		ActorEmail: middleware.Email(c),
		Action:     action,
		TargetType: targetType,
		TargetID:   targetID,
		IP:         c.IP(),
		Metadata:   audit.Meta(meta),
	}
	if uid := middleware.UserID(c); uid != "" {
		entry.ActorUserID = &uid
	}
	audit.Record(db, entry)
}
