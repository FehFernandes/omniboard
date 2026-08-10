package middleware

import (
	"strings"

	"github.com/cachyosso/omniboard/internal/config"
	"github.com/cachyosso/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
)

// Keys used in c.Locals to propagate the user context.
const (
	LocalUserID    = "userID"
	LocalEmail     = "email"
	LocalSessionID = "sessionID"
)

// Auth validates the access token and injects userID and email in the context.
// The userID ALWAYS comes from the token — never the client — and grounds ownership.
func Auth(jwtCfg *config.JWTConfig) fiber.Handler {
	return func(c *fiber.Ctx) error {
		header := c.Get("Authorization")
		if header == "" {
			return utils.Error(c, fiber.StatusUnauthorized, "No token provided")
		}
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			return utils.Error(c, fiber.StatusUnauthorized, "Invalid format. Use: Bearer <token>")
		}

		claims, err := utils.ValidateAccessToken(parts[1], jwtCfg.SecretKey)
		if err != nil {
			return utils.Error(c, fiber.StatusUnauthorized, "Invalid or expired token")
		}

		c.Locals(LocalUserID, claims.UserID)
		c.Locals(LocalEmail, claims.Email)
		c.Locals(LocalSessionID, claims.SessionID)
		return c.Next()
	}
}

// UserID returns the user_id from the context (always present after Auth).
func UserID(c *fiber.Ctx) string {
	if v, ok := c.Locals(LocalUserID).(string); ok {
		return v
	}
	return ""
}

// Email returns the email from the context.
func Email(c *fiber.Ctx) string {
	if v, ok := c.Locals(LocalEmail).(string); ok {
		return v
	}
	return ""
}

// SessionID returns the session id (sid) from the context — used to revoke the
// current session at logout.
func SessionID(c *fiber.Ctx) string {
	if v, ok := c.Locals(LocalSessionID).(string); ok {
		return v
	}
	return ""
}
