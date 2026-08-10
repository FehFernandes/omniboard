package server

import (
	"time"

	"github.com/cachyosso/omniboard/internal/config"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

// New builds the complete *fiber.App (config, middleware and routes).
// Reused by main and by the integration tests.
func New(db *gorm.DB, jwtCfg *config.JWTConfig, googleCfg *config.GoogleOAuth) *fiber.App {
	app := fiber.New(fiber.Config{
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		BodyLimit:    10 * 1024 * 1024,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			msg := err.Error()
			if config.IsProduction() {
				msg = "Internal server error"
			}
			return c.Status(code).JSON(fiber.Map{"success": false, "error": msg})
		},
	})

	setupMiddleware(app)
	registerRoutes(app, db, jwtCfg, googleCfg)
	return app
}
