package server

import (
	"os"

	"github.com/FehFernandes/omniboard/internal/config"
	"github.com/FehFernandes/omniboard/internal/logging"
	"github.com/FehFernandes/omniboard/internal/metrics"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/fiber/v2/middleware/requestid"
)

// setupMiddleware registra os middlewares globais.
func setupMiddleware(app *fiber.App) {
	logging.Setup()

	app.Use(recover.New())

	// Request ID: generates/propagates X-Request-ID per request (log correlation).
	app.Use(requestid.New())

	// Prometheus metrics: measures every request and exposes /metrics.
	// Se METRICS_TOKEN estiver definido, /metrics exige Bearer token.
	mc := metrics.New()
	app.Use(mc.Middleware())
	app.Get("/metrics", mc.Handler())

	// Structured access log (slog), always on except in tests (noise).
	if os.Getenv("ENV") != "test" {
		app.Use(logging.AccessLog())
	}

	// Security headers
	app.Use(func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		if config.IsProduction() {
			c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		return c.Next()
	})

	origins := os.Getenv("CORS_ORIGINS")
	if origins == "" {
		origins = "http://localhost:5173,http://localhost:5174"
	}
	app.Use(cors.New(cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		AllowHeaders:     "Origin,Content-Type,Accept,Authorization",
		AllowCredentials: true,
		MaxAge:           3600,
	}))
}
