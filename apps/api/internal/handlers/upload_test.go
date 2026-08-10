package handlers_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/cachyosso/omniboard/internal/handlers"
	"github.com/cachyosso/omniboard/internal/middleware"
	"github.com/cachyosso/omniboard/internal/storage"
)

// app assembles only what is needed: the upload handler does not touch the
// database, so the test needs no Postgres (runs on any machine and in CI).
func appUpload(cfg storage.Config, userID string) *fiber.App {
	app := fiber.New()
	h := handlers.NewUploadHandler(storage.New(cfg))
	app.Use(func(c *fiber.Ctx) error {
		c.Locals(middleware.LocalUserID, userID)
		return c.Next()
	})
	app.Post("/api/uploads/images", h.PresignImage)
	app.Get("/api/uploads/limits", h.Limits)
	return app
}

func cfgValida() storage.Config {
	return storage.Config{
		Endpoint:        "https://acc.r2.cloudflarestorage.com",
		Bucket:          "omniboard",
		AccessKeyID:     "key",
		SecretAccessKey: "secret",
		PublicBaseURL:   "https://cdn.exemplo.com",
		Region:          "auto",
		MaxBytes:        2048,
		Expires:         time.Minute,
	}
}

func post(t *testing.T, app *fiber.App, body string) (*http.Response, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/images", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, err := app.Test(req, -1)
	require.NoError(t, err)
	raw, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res, out
}

func TestPresignImageOK(t *testing.T) {
	app := appUpload(cfgValida(), "user-1")
	res, body := post(t, app, `{"filename":"foto.png","content_type":"image/png","size":1000}`)

	require.Equal(t, fiber.StatusOK, res.StatusCode)
	up, ok := body["upload"].(map[string]any)
	require.True(t, ok, "the response must contain `upload`: %v", body)

	assert.Contains(t, up["upload_url"], "X-Amz-Signature=")
	assert.Contains(t, up["upload_url"], "/omniboard/u/user-1/")
	assert.Contains(t, up["public_url"], "https://cdn.exemplo.com/u/user-1/")
	assert.Equal(t, "image/png", up["content_type"])
	assert.EqualValues(t, 2048, up["max_bytes"])

	// The upload URL must not expose the account secret.
	assert.NotContains(t, up["upload_url"], "secret")
}

// The owner comes from the token, never from the body: two users cannot write in
// the same prefix even if they ask for the same file.
func TestPresignIsolatesPerUser(t *testing.T) {
	_, a := post(t, appUpload(cfgValida(), "user-a"), `{"filename":"x.png","content_type":"image/png","size":10}`)
	_, b := post(t, appUpload(cfgValida(), "user-b"), `{"filename":"x.png","content_type":"image/png","size":10}`)

	ka := a["upload"].(map[string]any)["key"].(string)
	kb := b["upload"].(map[string]any)["key"].(string)
	assert.True(t, strings.HasPrefix(ka, "u/user-a/"))
	assert.True(t, strings.HasPrefix(kb, "u/user-b/"))
	assert.NotEqual(t, ka, kb)
}

func TestPresignRejectsInvalidInput(t *testing.T) {
	app := appUpload(cfgValida(), "user-1")

	casos := []struct {
		name   string
		body   string
		status int
	}{
		{"unsupported type", `{"filename":"a.svg","content_type":"image/svg+xml","size":10}`, fiber.StatusUnsupportedMediaType},
		{"executable", `{"filename":"a.exe","content_type":"application/octet-stream","size":10}`, fiber.StatusUnsupportedMediaType},
		{"above the limit", `{"filename":"a.png","content_type":"image/png","size":2049}`, fiber.StatusRequestEntityTooLarge},
		{"no size", `{"filename":"a.png","content_type":"image/png"}`, fiber.StatusBadRequest},
		{"invalid body", `{`, fiber.StatusBadRequest},
	}
	for _, c := range casos {
		t.Run(c.name, func(t *testing.T) {
			res, body := post(t, app, c.body)
			assert.Equal(t, c.status, res.StatusCode)
			assert.Equal(t, false, body["success"])
		})
	}
}

// With no bucket configured the API has to say so in a distinguishable way (501),
// so the client falls back to the embedded mode instead of losing the image.
func TestPresignWithoutConfiguredBucket(t *testing.T) {
	app := appUpload(storage.Config{}, "user-1")
	res, body := post(t, app, `{"filename":"a.png","content_type":"image/png","size":10}`)
	assert.Equal(t, fiber.StatusNotImplemented, res.StatusCode)
	assert.Equal(t, false, body["success"])
}

func TestLimitsAnnouncesAvailability(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/uploads/limits", nil)
	res, err := appUpload(cfgValida(), "user-1").Test(req, -1)
	require.NoError(t, err)
	raw, _ := io.ReadAll(res.Body)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))
	assert.Equal(t, true, body["enabled"])
	assert.EqualValues(t, 2048, body["max_bytes"])
	assert.Contains(t, body["types"], "image/png")

	req = httptest.NewRequest(http.MethodGet, "/api/uploads/limits", nil)
	res, err = appUpload(storage.Config{}, "user-1").Test(req, -1)
	require.NoError(t, err)
	raw, _ = io.ReadAll(res.Body)
	body = map[string]any{}
	require.NoError(t, json.Unmarshal(raw, &body))
	assert.Equal(t, false, body["enabled"])
}
