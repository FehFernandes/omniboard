// Package docs serves the API documentation: the versioned OpenAPI spec
// (embedded via go:embed) at /openapi.yaml and a Redoc page at /docs.
//
// The spec is the source of truth for the API contract — edit openapi.yaml when
// adding or changing endpoints. Being embedded, it works in the distroless image
// without copying files.
package docs

import (
	_ "embed"

	"github.com/gofiber/fiber/v2"
)

// spec is the content of openapi.yaml embedded in the binary.
//
//go:embed openapi.yaml
var spec []byte

// redocHTML renderiza o spec com o Redoc (carregado de CDN). Se a sua CSP
// blocking external scripts, swap the script URL for a self-hosted copy.
const redocHTML = `<!DOCTYPE html>
<html>
  <head>
    <title>API Docs</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <redoc spec-url="/openapi.yaml"></redoc>
    <script src="https://cdn.redocly.com/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`

// Register mounts the documentation routes (public).
func Register(app *fiber.App) {
	app.Get("/openapi.yaml", func(c *fiber.Ctx) error {
		c.Set("Content-Type", "application/yaml")
		return c.Send(spec)
	})
	app.Get("/docs", func(c *fiber.Ctx) error {
		c.Set("Content-Type", "text/html; charset=utf-8")
		return c.SendString(redocHTML)
	})
}
