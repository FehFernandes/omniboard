package server

import (
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	redisstore "github.com/gofiber/storage/redis/v3"
)

// newLimiterStorage decide o backend de contagem do rate limiter.
//
//   - Without REDIS_URL: returns nil → the limiter uses an in-memory store (per
//     process). Enough for a single instance; it does NOT share counts across
//     replicas.
//   - With REDIS_URL: uses Redis as a distributed store, so the limit is effective
//     even with several instances behind a load balancer.
//
// Example: REDIS_URL=redis://default:password@localhost:6379/0
func newLimiterStorage() fiber.Storage {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		if os.Getenv("ENV") == "production" {
			log.Println("⚠️  REDIS_URL not set: in-memory rate limiter (per instance). " +
				"With multiple replicas the limit is not shared — set REDIS_URL in production.")
		}
		return nil
	}
	return redisstore.New(redisstore.Config{URL: url})
}
