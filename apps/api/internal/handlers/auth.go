package handlers

// Application authentication.
//
// The only entry path is the Google login (see auth_google.go). There is no
// signup, password login, password recovery or email verification by link —
// Google already settles identity and ownership of the email. What is left here
// is the SESSION life cycle, which belongs to the application: issuing the token
// pair, rotation, looking up the current user and revocation.

import (
	"time"

	"github.com/FehFernandes/omniboard/internal/config"
	"github.com/FehFernandes/omniboard/internal/models"
	"github.com/FehFernandes/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AuthHandler groups the authentication endpoints.
type AuthHandler struct {
	db     *gorm.DB
	jwt    *config.JWTConfig
	google *config.GoogleOAuth
}

// NewAuthHandler creates the auth handler.
func NewAuthHandler(db *gorm.DB, jwt *config.JWTConfig, google *config.GoogleOAuth) *AuthHandler {
	return &AuthHandler{db: db, jwt: jwt, google: google}
}

// issueTokens creates a NEW session (refresh token) and returns the auth response.
// Each call = a new session (multi-device). Refresh does NOT use this: it
// rotates the existing session.
// `extra` are optional additional fields merged into the response.
func (h *AuthHandler) issueTokens(c *fiber.Ctx, u *models.User, status int, extra fiber.Map) error {
	sid := uuid.NewString()
	pair, err := utils.GenerateTokenPair(u, h.jwt, sid)
	if err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not generate the tokens")
	}

	now := time.Now()
	// We persist only the HASH of the refresh token. The raw value only travels to
	// the client in the response — if the database leaks, the tokens are not reusable.
	session := models.Session{
		UserID:      u.ID,
		RefreshHash: utils.HashToken(pair.RefreshToken),
		UserAgent:   c.Get("User-Agent"),
		IP:          c.IP(),
		ExpiresAt:   now.Add(h.jwt.RefreshExpirationTime),
	}
	session.ID = sid // the session id is the same sid carried in the JWT
	if err := h.db.Create(&session).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not register the session")
	}
	h.db.Model(u).Updates(map[string]interface{}{"last_login_at": now, "last_login_ip": c.IP()})

	resp := fiber.Map{
		"access_token":  pair.AccessToken,
		"refresh_token": pair.RefreshToken,
		"token_type":    "Bearer",
		"user":          u.ToResponse(),
	}
	for k, v := range extra {
		resp[k] = v
	}
	return utils.Success(c, status, resp)
}
