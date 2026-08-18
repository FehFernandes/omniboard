package server

import (
	"context"
	"os"
	"time"

	"github.com/FehFernandes/omniboard/internal/config"
	"github.com/FehFernandes/omniboard/internal/docs"
	"github.com/FehFernandes/omniboard/internal/handlers"
	"github.com/FehFernandes/omniboard/internal/middleware"
	"github.com/FehFernandes/omniboard/internal/payments"
	"github.com/FehFernandes/omniboard/internal/storage"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"gorm.io/gorm"
)

// registerRoutes wires up the API's whole route tree.
func registerRoutes(app *fiber.App, db *gorm.DB, jwtCfg *config.JWTConfig, googleCfg *config.GoogleOAuth) {
	authH := handlers.NewAuthHandler(db, jwtCfg, googleCfg)
	itemH := handlers.NewItemHandler(db)
	auditH := handlers.NewAuditHandler(db)
	// Billing: pluggable provider (Stripe when STRIPE_SECRET_KEY is set; Fake in dev).
	billingH := handlers.NewBillingHandler(db, payments.New())
	boardH := handlers.NewBoardHandler(db)
	wsH := handlers.NewWorkspaceHandler(db)
	// Uploads: a presigned URL so the client uploads images straight to the bucket
	// (R2). Disabled — and announced as such — when the environment has no bucket.
	uploadH := handlers.NewUploadHandler(storage.New(config.LoadR2()))
	// Public read-only links to a board.
	shareH := handlers.NewShareHandler(db)
	// gen:handlers — do not remove: resource generator anchor (tools/gen-resource.mjs)

	authLimiter := limiter.New(limiter.Config{
		Max:        10,
		Expiration: 15 * time.Minute,
		// Distributed store (Redis) when REDIS_URL is set; otherwise in-memory per
		// instance. See newLimiterStorage.
		Storage: newLimiterStorage(),
		// Only active in production. Disabled in dev/test (all tests share the same
		// IP, and in dev it gets in the way of manually testing login).
		Next: func(c *fiber.Ctx) bool { return os.Getenv("ENV") != "production" },
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"success": false, "error": "Muitas tentativas. Tente novamente em 15 minutos.",
			})
		},
	})

	// Signing an upload is cheap, but not free — and every signature is write
	// permission on the bucket. Generous enough to paste several images at once,
	// while still capping per IP.
	uploadLimiter := limiter.New(limiter.Config{
		Max:        60,
		Expiration: time.Minute,
		Storage:    newLimiterStorage(),
		Next:       func(c *fiber.Ctx) bool { return os.Getenv("ENV") != "production" },
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"success": false, "error": "Too many uploads in a row. Wait a moment.",
			})
		},
	})

	// Public shared-board route: there is no session to hold accountable, so the
	// per-IP cap is what prevents token scanning and read abuse.
	publicLimiter := limiter.New(limiter.Config{
		Max:        120,
		Expiration: time.Minute,
		Storage:    newLimiterStorage(),
		Next:       func(c *fiber.Ctx) bool { return os.Getenv("ENV") != "production" },
		LimitReached: func(c *fiber.Ctx) error {
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"success": false, "error": "Too many requests. Try again in a moment.",
			})
		},
	})

	// Liveness: the process is up. Does not touch the database (cheap, always 200).
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"success": true, "status": "ok", "service": "omniboard"})
	})

	// Readiness: ready to take traffic? Pings the database (short timeout).
	app.Get("/ready", func(c *fiber.Ctx) error {
		sqlDB, err := db.DB()
		if err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"success": false, "status": "db_unavailable"})
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := sqlDB.PingContext(ctx); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"success": false, "status": "db_unavailable"})
		}
		return c.JSON(fiber.Map{"success": true, "status": "ready"})
	})

	api := app.Group("/api")

	// API documentation: the OpenAPI spec at /openapi.yaml and Redoc at /docs.
	docs.Register(app)

	// ── Authentication: Google login is the ONLY way in ──
	// There is no /register, /login, /forgot-password or /reset-password: the
	// application stores no passwords. Identity and email ownership come from
	// Google.
	auth := api.Group("/auth")
	// Entry point of the flow. This is a top-level browser navigation (not a
	// fetch): it responds with a redirect to Google's consent screen.
	auth.Get("/google", authLimiter, authH.GoogleStart)
	// Google's return. No rate limit of its own: access is controlled by the state
	// cookie, and limiting here would break legitimate logins behind NAT.
	auth.Get("/google/callback", authH.GoogleCallback)
	// The frontend exchanges the callback's opaque code for the app's token pair.
	auth.Post("/google/exchange", authLimiter, authH.GoogleExchange)
	// Session rotation (not a login path: it requires a valid refresh token).
	auth.Post("/refresh", authH.Refresh)

	// ── Public billing ──
	// Plan catalog (pricing is public information).
	api.Get("/billing/plans", billingH.ListPlans)
	// Provider webhook: authenticated by the provider's own signature
	// (Stripe-Signature), NOT by JWT. Configure the endpoint in Stripe's dashboard.
	api.Post("/billing/webhook", billingH.Webhook)
	// FAKE checkout completion (dev only; 404 when the provider is real).
	api.Get("/billing/dev/complete", billingH.DevComplete)

	// ── Board shared by link (PUBLIC) ──
	// The token is the credential: no JWT. Rate limited per IP because it is the
	// only route that answers people without an account — and the only one a leaked
	// link reaches.
	api.Get("/public/shares/:token", publicLimiter, shareH.Public)

	// ── Rotas autenticadas ──
	protected := api.Group("", middleware.Auth(jwtCfg))
	protected.Get("/auth/me", authH.Me)
	protected.Put("/auth/me", authH.UpdateProfile)
	protected.Post("/auth/logout", authH.Logout)
	protected.Post("/auth/logout-all", authH.LogoutAll)

	// Audit trail of the user's own account.
	protected.Get("/audit-logs", auditH.List)

	// The user's own billing/subscription.
	protected.Get("/billing/subscription", billingH.GetSubscription)
	protected.Post("/billing/checkout", billingH.CreateCheckout)
	protected.Post("/billing/portal", billingH.CreatePortal)

	// 2FA (TOTP): enroll → verify (ativa) → disable.
	protected.Post("/auth/2fa/enroll", authH.Enroll)
	protected.Post("/auth/2fa/verify", authH.Verify)
	protected.Post("/auth/2fa/disable", authH.Disable)

	// Example resource (Item) — a CRUD template with per-user ownership.
	// Copy/rename it for your real entities.
	protected.Get("/items", itemH.List)
	protected.Post("/items", itemH.Create)
	protected.Get("/items/:id", itemH.Get)
	protected.Put("/items/:id", itemH.Update)
	protected.Delete("/items/:id", itemH.Delete)
	protected.Get("/boards", boardH.List)
	protected.Post("/boards", boardH.Create)
	protected.Get("/boards/:id", boardH.Get)
	protected.Put("/boards/:id", boardH.Update)
	protected.Delete("/boards/:id", boardH.Delete)

	// The user's singleton workspace (the full BoardManager snapshot).
	protected.Get("/workspace", wsH.Get)
	protected.Put("/workspace", wsH.Put)

	// The user's own share links.
	protected.Get("/shares", shareH.List)
	protected.Post("/shares", shareH.Create)
	protected.Delete("/shares/:id", shareH.Revoke)

	// Image uploads: the client asks for a signed URL and PUTs straight to the
	// bucket. Rate limited per IP because signing is cheap, but not free.
	protected.Get("/uploads/limits", uploadH.Limits)
	protected.Post("/uploads/images", uploadLimiter, uploadH.PresignImage)
	// gen:routes — do not remove: resource generator anchor (tools/gen-resource.mjs)
}
