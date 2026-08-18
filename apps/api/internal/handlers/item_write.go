package handlers

import (
	"github.com/FehFernandes/omniboard/internal/middleware"
	"github.com/FehFernandes/omniboard/internal/models"
	"github.com/FehFernandes/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm/clause"
)

type itemInput struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

func validateItem(in itemInput) string {
	if utils.SanitizeString(in.Title) == "" {
		return "Title is required"
	}
	if in.Status != "" && !models.ValidItemStatus(in.Status) {
		return "Invalid status"
	}
	return ""
}

// Create registers an item for the authenticated user.
// POST /api/items
func (h *ItemHandler) Create(c *fiber.Ctx) error {
	var in itemInput
	if err := c.BodyParser(&in); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if msg := validateItem(in); msg != "" {
		return utils.Error(c, fiber.StatusBadRequest, msg)
	}

	status := in.Status
	if status == "" {
		status = "active"
	}

	item := models.Item{
		Title: utils.SanitizeString(in.Title), Description: in.Description, Status: status,
	}
	item.UserID = middleware.UserID(c) // owner ALWAYS from the token, never from the client

	if err := h.db.Create(&item).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not create the item")
	}
	return utils.Success(c, fiber.StatusCreated, fiber.Map{"item": item})
}

// Update changes fields of an item (scoped by the owner).
// PUT /api/items/:id
func (h *ItemHandler) Update(c *fiber.Ctx) error {
	var item models.Item
	if err := h.scoped(c).Where("id = ?", c.Params("id")).First(&item).Error; err != nil {
		return utils.FetchError(c, err, "Item not found")
	}

	var in itemInput
	if err := c.BodyParser(&in); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if msg := validateItem(in); msg != "" {
		return utils.Error(c, fiber.StatusBadRequest, msg)
	}

	// Field whitelist — id and user_id never come in here (anti mass-assignment).
	updates := map[string]interface{}{
		"title":       utils.SanitizeString(in.Title),
		"description": in.Description,
	}
	if in.Status != "" {
		updates["status"] = in.Status
	}
	// RETURNING brings the already-updated row in the same query — it avoids an
	// extra SELECT just to return the fresh state (including updated_at).
	if err := h.db.Model(&item).Clauses(clause.Returning{}).Updates(updates).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not update the item")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"item": item})
}

// Delete removes (soft delete) an item scoped by the owner.
// DELETE /api/items/:id
func (h *ItemHandler) Delete(c *fiber.Ctx) error {
	res := h.scoped(c).Where("id = ?", c.Params("id")).Delete(&models.Item{})
	if res.Error != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not remove the item")
	}
	if res.RowsAffected == 0 {
		return utils.Error(c, fiber.StatusNotFound, "Item not found")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"message": "Item removido"})
}
