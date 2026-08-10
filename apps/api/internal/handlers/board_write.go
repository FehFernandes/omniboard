package handlers

import (
	"github.com/cachyosso/omniboard/internal/middleware"
	"github.com/cachyosso/omniboard/internal/models"
	"github.com/cachyosso/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
	"gorm.io/datatypes"
	"gorm.io/gorm/clause"
)

type boardInput struct {
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Status      string         `json:"status"`
	Data        datatypes.JSON `json:"data"`
}

func validateBoard(in boardInput) string {
	if utils.SanitizeString(in.Title) == "" {
		return "Title is required"
	}
	if in.Status != "" && !models.ValidBoardStatus(in.Status) {
		return "Invalid status"
	}
	return ""
}

// Create registers a record for the authenticated user.
// POST /api/boards
func (h *BoardHandler) Create(c *fiber.Ctx) error {
	var in boardInput
	if err := c.BodyParser(&in); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if msg := validateBoard(in); msg != "" {
		return utils.Error(c, fiber.StatusBadRequest, msg)
	}

	status := in.Status
	if status == "" {
		status = "active"
	}

	record := models.Board{
		Title: utils.SanitizeString(in.Title), Description: in.Description, Status: status,
		Data: in.Data,
	}
	record.UserID = middleware.UserID(c) // owner ALWAYS from the token, never from the client

	if err := h.db.Create(&record).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not create the board")
	}
	return utils.Success(c, fiber.StatusCreated, fiber.Map{"board": record})
}

// Update changes fields (scoped by the owner).
// PUT /api/boards/:id
func (h *BoardHandler) Update(c *fiber.Ctx) error {
	var record models.Board
	if err := h.scoped(c).Where("id = ?", c.Params("id")).First(&record).Error; err != nil {
		return utils.FetchError(c, err, "Board not found")
	}

	var in boardInput
	if err := c.BodyParser(&in); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if msg := validateBoard(in); msg != "" {
		return utils.Error(c, fiber.StatusBadRequest, msg)
	}

	updates := map[string]interface{}{
		"title":       utils.SanitizeString(in.Title),
		"description": in.Description,
	}
	if in.Status != "" {
		updates["status"] = in.Status
	}
	if in.Data != nil {
		updates["data"] = in.Data
	}
	if err := h.db.Model(&record).Clauses(clause.Returning{}).Updates(updates).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not update the board")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"board": record})
}

// Delete removes (soft delete) a record scoped by the owner.
// DELETE /api/boards/:id
func (h *BoardHandler) Delete(c *fiber.Ctx) error {
	res := h.scoped(c).Where("id = ?", c.Params("id")).Delete(&models.Board{})
	if res.Error != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not remove the board")
	}
	if res.RowsAffected == 0 {
		return utils.Error(c, fiber.StatusNotFound, "Board not found")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"message": "Board removido"})
}
