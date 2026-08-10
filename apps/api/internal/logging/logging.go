// Package logging centralizes structured logging (log/slog) and the access log
// middleware. Always-on (except in tests): JSON in production, human-readable
// text in dev. Each request comes out with request_id, method, route, status and
// latency — ready for aggregators (CloudWatch, Loki, etc.).
package logging

import (
	"log/slog"
	"os"
	"time"

	"github.com/cachyosso/omniboard/internal/config"
	"github.com/gofiber/fiber/v2"
)

// Setup configures the global logger (slog.Default). Idempotent.
func Setup() *slog.Logger {
	level := slog.LevelInfo
	if config.IsDevelopment() {
		level = slog.LevelDebug
	}
	opts := &slog.HandlerOptions{Level: level}

	var h slog.Handler
	if config.IsProduction() {
		h = slog.NewJSONHandler(os.Stdout, opts) // structured for machines
	} else {
		h = slog.NewTextHandler(os.Stdout, opts) // readable for humans
	}
	l := slog.New(h)
	slog.SetDefault(l)
	return l
}

// AccessLog records one structured line per request. It skips /health and /ready
// (health check noise). The level reflects the status range (5xx=error, 4xx=warn).
func AccessLog() fiber.Handler {
	return func(c *fiber.Ctx) error {
		if p := c.Path(); p == "/health" || p == "/ready" {
			return c.Next()
		}
		start := time.Now()
		err := c.Next()

		status := c.Response().StatusCode()
		attrs := []any{
			slog.String("request_id", requestID(c)),
			slog.String("method", c.Method()),
			slog.String("path", c.Path()),
			slog.Int("status", status),
			slog.String("latency", time.Since(start).String()),
			slog.String("ip", c.IP()),
		}
		switch {
		case status >= 500:
			slog.Error("http_request", attrs...)
		case status >= 400:
			slog.Warn("http_request", attrs...)
		default:
			slog.Info("http_request", attrs...)
		}
		return err
	}
}

func requestID(c *fiber.Ctx) string {
	if v, ok := c.Locals("requestid").(string); ok {
		return v
	}
	return ""
}
