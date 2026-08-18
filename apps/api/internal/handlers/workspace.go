package handlers

import (
	"errors"

	"github.com/FehFernandes/omniboard/internal/middleware"
	"github.com/FehFernandes/omniboard/internal/models"
	"github.com/FehFernandes/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// WorkspaceHandler exposes the user's singleton workspace.
type WorkspaceHandler struct {
	db *gorm.DB
}

func NewWorkspaceHandler(db *gorm.DB) *WorkspaceHandler {
	return &WorkspaceHandler{db: db}
}

// Get returns the user's workspace; creates an empty one if it does not exist yet.
// GET /api/workspace
func (h *WorkspaceHandler) Get(c *fiber.Ctx) error {
	uid := middleware.UserID(c)
	var ws models.Workspace
	err := h.db.Where("user_id = ?", uid).First(&ws).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		ws = models.Workspace{UserID: uid}
		if err := h.db.Create(&ws).Error; err != nil {
			return utils.Error(c, fiber.StatusInternalServerError, "Could not create the workspace")
		}
	} else if err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not load the workspace")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"workspace": ws})
}

type workspaceInput struct {
	Data datatypes.JSON `json:"data"`
	// Version — the version the client read. When present and different from the
	// current one, the save is refused with 409 (another tab/device wrote first).
	// Absent or 0 = old client, which does not check.
	Version *int64 `json:"version"`
}

// Put upserts the user's workspace (owner always from the token).
//
// Optimistic concurrency: the client sends the version it read and receives the
// new one. If the version does not match, we return 409 with the server state —
// overwriting silently would erase the other tab's work with nobody noticing.
//
// PUT /api/workspace
func (h *WorkspaceHandler) Put(c *fiber.Ctx) error {
	uid := middleware.UserID(c)
	var in workspaceInput
	if err := c.BodyParser(&in); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}

	var ws models.Workspace
	err := h.db.Where("user_id = ?", uid).First(&ws).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		ws = models.Workspace{UserID: uid, Data: in.Data, Version: 1}
		if err := h.db.Create(&ws).Error; err != nil {
			return utils.Error(c, fiber.StatusInternalServerError, "Could not save the workspace")
		}
		return utils.Success(c, fiber.StatusOK, fiber.Map{"workspace": ws})
	} else if err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not save the workspace")
	}

	if in.Version != nil && *in.Version > 0 && *in.Version != ws.Version {
		// 409 with the current state: the client reloads without needing another round trip.
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"success":   false,
			"error":     "The workspace was changed in another tab or device",
			"conflict":  true,
			"workspace": ws,
		})
	}

	// UPDATE conditioned on the version: two simultaneous requests with the same
	// version — one wins, the other sees 0 rows affected and gets a 409. The check
	// above is not enough (there is a window between the SELECT and the UPDATE).
	res := h.db.Model(&models.Workspace{}).
		Where("id = ? AND version = ?", ws.ID, ws.Version).
		Updates(map[string]any{"data": in.Data, "version": ws.Version + 1})
	if res.Error != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not save the workspace")
	}
	if res.RowsAffected == 0 {
		var current models.Workspace
		h.db.Where("id = ?", ws.ID).First(&current)
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"success":   false,
			"error":     "The workspace was changed in another tab or device",
			"conflict":  true,
			"workspace": current,
		})
	}

	ws.Data = in.Data
	ws.Version++
	return utils.Success(c, fiber.StatusOK, fiber.Map{"workspace": ws})
}
