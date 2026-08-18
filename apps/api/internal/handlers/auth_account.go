package handlers

// The user's own profile data.
//
// There are no password-change or email-change endpoints: the password does not
// exist in this app, and the email is property of the Google account — change it
// there and it is resynced at the next login (see resolveGoogleUser).

import (
	"github.com/FehFernandes/omniboard/internal/middleware"
	"github.com/FehFernandes/omniboard/internal/models"
	"github.com/FehFernandes/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
)

type updateProfileRequest struct {
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

// UpdateProfile updates the user's own profile data (name/avatar).
// PUT /api/auth/me
func (h *AuthHandler) UpdateProfile(c *fiber.Ctx) error {
	userID := middleware.UserID(c)

	var req updateProfileRequest
	if err := c.BodyParser(&req); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}
	req.Name = utils.SanitizeString(req.Name)
	if req.Name == "" {
		return utils.Error(c, fiber.StatusBadRequest, "Name is required")
	}

	// Field whitelist — email and the Google link never come in here.
	if err := h.db.Model(&models.User{}).Where("id = ?", userID).
		Updates(map[string]interface{}{"name": req.Name, "avatar": req.Avatar}).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not update the profile")
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return utils.Error(c, fiber.StatusNotFound, "User not found")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"user": user.ToResponse()})
}
