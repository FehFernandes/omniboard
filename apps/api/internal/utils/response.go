package utils

import (
	"errors"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

// Error sends a standardized error response.
func Error(c *fiber.Ctx, status int, message string) error {
	return c.Status(status).JSON(fiber.Map{
		"success": false,
		"error":   message,
	})
}

// FetchError maps the error of a database lookup to the correct HTTP status:
// missing record → 404; any other error (e.g.: exhausted pool) → 500. That way
// a database problem is not masked as "not found".
func FetchError(c *fiber.Ctx, err error, notFoundMsg string) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Error(c, fiber.StatusNotFound, notFoundMsg)
	}
	return Error(c, fiber.StatusInternalServerError, "Could not query the data")
}

// Success sends a success response with an arbitrary payload.
func Success(c *fiber.Ctx, status int, data fiber.Map) error {
	payload := fiber.Map{"success": true}
	for k, v := range data {
		payload[k] = v
	}
	return c.Status(status).JSON(payload)
}
