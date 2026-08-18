package handlers

// Session life cycle: refresh token rotation, current user and revocation.
// Session creation happens at the end of the OAuth flow (see auth_google.go).

import (
	"time"

	"github.com/FehFernandes/omniboard/internal/middleware"
	"github.com/FehFernandes/omniboard/internal/models"
	"github.com/FehFernandes/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
)

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// Refresh rotates the session: validates the refresh token, checks the session
// (sid) and issues a new pair keeping the SAME sid (device continuity).
// POST /api/auth/refresh
func (h *AuthHandler) Refresh(c *fiber.Ctx) error {
	var req refreshRequest
	if err := c.BodyParser(&req); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}

	claims, err := utils.ValidateRefreshToken(req.RefreshToken, h.jwt.RefreshSecretKey)
	if err != nil {
		return utils.Error(c, fiber.StatusUnauthorized, "Invalid or expired refresh token")
	}

	// The session referenced by the token (sid), scoped by the user.
	var session models.Session
	if err := h.db.Where("id = ? AND user_id = ?", claims.SessionID, claims.UserID).First(&session).Error; err != nil {
		return utils.Error(c, fiber.StatusUnauthorized, "Session not found")
	}
	if !session.IsActive() {
		return utils.Error(c, fiber.StatusUnauthorized, "Session expired or revoked")
	}
	// The hash has to match the presented refresh. If it does not, it is an
	// already-rotated token (possible reuse/theft) — revoke the session as a precaution.
	if session.RefreshHash != utils.HashToken(req.RefreshToken) {
		now := time.Now()
		h.db.Model(&session).Update("revoked_at", now)
		return utils.Error(c, fiber.StatusUnauthorized, "Refresh token revogado")
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", claims.UserID).Error; err != nil {
		return utils.Error(c, fiber.StatusUnauthorized, "User not found")
	}
	if !user.IsActive {
		return utils.Error(c, fiber.StatusForbidden, "User is deactivated")
	}

	// Rotate: new pair with the SAME sid; updates the session's hash and expiration.
	pair, err := utils.GenerateTokenPair(&user, h.jwt, session.ID)
	if err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not generate the tokens")
	}
	now := time.Now()
	if err := h.db.Model(&session).Updates(map[string]interface{}{
		"refresh_hash": utils.HashToken(pair.RefreshToken),
		"expires_at":   now.Add(h.jwt.RefreshExpirationTime),
		"ip":           c.IP(),
		"user_agent":   c.Get("User-Agent"),
	}).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not refresh the session")
	}

	return utils.Success(c, fiber.StatusOK, fiber.Map{
		"access_token":  pair.AccessToken,
		"refresh_token": pair.RefreshToken,
		"token_type":    "Bearer",
		"user":          user.ToResponse(),
	})
}

// Me returns the authenticated user.
// GET /api/auth/me
func (h *AuthHandler) Me(c *fiber.Ctx) error {
	userID := middleware.UserID(c)

	var user models.User
	if err := h.db.First(&user, "id = ?", userID).Error; err != nil {
		return utils.Error(c, fiber.StatusNotFound, "User not found")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"user": user.ToResponse()})
}

// Logout revokes the current session (identified by the sid of the access token).
// Other sessions (other devices) stay active.
// POST /api/auth/logout
func (h *AuthHandler) Logout(c *fiber.Ctx) error {
	userID := middleware.UserID(c)
	sid := middleware.SessionID(c)
	now := time.Now()
	h.db.Model(&models.Session{}).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", sid, userID).
		Update("revoked_at", now)
	// Note: the access token is stateless and remains valid until it expires
	// (JWT_ACCESS_EXPIRATION_MINUTES). Logout invalidates the renewal (refresh).
	return utils.Success(c, fiber.StatusOK, fiber.Map{"message": "Logout realizado"})
}

// LogoutAll revokes ALL the user's active sessions (all devices).
// POST /api/auth/logout-all
func (h *AuthHandler) LogoutAll(c *fiber.Ctx) error {
	userID := middleware.UserID(c)
	now := time.Now()
	h.db.Model(&models.Session{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", now)
	return utils.Success(c, fiber.StatusOK, fiber.Map{"message": "All sessions were terminated"})
}
