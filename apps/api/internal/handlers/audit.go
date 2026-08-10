package handlers

import (
	"github.com/cachyosso/omniboard/internal/middleware"
	"github.com/cachyosso/omniboard/internal/models"
	"github.com/cachyosso/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

// AuditHandler exposes reading the account's own audit trail.
type AuditHandler struct {
	db *gorm.DB
}

// NewAuditHandler creates the audit handler.
func NewAuditHandler(db *gorm.DB) *AuditHandler {
	return &AuditHandler{db: db}
}

// List returns the audit events of the authenticated user (most recent first),
// by cursor pagination. Optional filter by ?action=.
// GET /api/audit-logs
func (h *AuditHandler) List(c *fiber.Ctx) error {
	p := utils.ParsePage(c)

	// Scoped by owner — each user only sees their own activity.
	q := h.db.Model(&models.AuditLog{}).Where("actor_user_id = ?", middleware.UserID(c))
	if action := c.Query("action"); action != "" {
		q = q.Where("action = ?", action)
	}
	if p.Cursor != "" {
		if t, id, ok := utils.DecodeCursor(p.Cursor); ok {
			q = q.Where("(created_at, id) < (?, ?)", t, id)
		}
	}

	var logs []models.AuditLog
	if err := q.Order("created_at DESC, id DESC").Limit(p.Limit + 1).Find(&logs).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not list the audit trail")
	}

	hasMore := len(logs) > p.Limit
	if hasMore {
		logs = logs[:p.Limit]
	}
	next := ""
	if hasMore && len(logs) > 0 {
		last := logs[len(logs)-1]
		next = utils.EncodeCursor(last.CreatedAt, last.ID)
	}

	return utils.Success(c, fiber.StatusOK, fiber.Map{
		"audit_logs": logs, "has_more": hasMore, "next_cursor": next,
	})
}
