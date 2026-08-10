package handlers

import (
	"errors"

	"github.com/cachyosso/omniboard/internal/middleware"
	"github.com/cachyosso/omniboard/internal/storage"
	"github.com/cachyosso/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
)

// UploadHandler delivers presigned URLs for the client to upload images straight
// to the bucket. No file byte passes through here.
type UploadHandler struct {
	client *storage.Client
}

func NewUploadHandler(client *storage.Client) *UploadHandler {
	return &UploadHandler{client: client}
}

type presignInput struct {
	// Original name: used only to preserve the extension.
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
}

// PresignImage returns where to upload the image and its public URL.
//
// The client is required to inform the size: refusing before the upload is more
// honest (and cheaper) than letting the PUT fail at the bucket.
//
// POST /api/uploads/images
func (h *UploadHandler) PresignImage(c *fiber.Ctx) error {
	var in presignInput
	if err := c.BodyParser(&in); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}

	up, err := h.client.PresignImage(middleware.UserID(c), in.Filename, in.ContentType, in.Size)
	switch {
	case errors.Is(err, storage.ErrNotConfigured):
		// 501: it is neither a client error nor a transient failure — the server has no
		// bucket. The front end uses this to fall back to the embedded mode.
		return utils.Error(c, fiber.StatusNotImplemented, "Uploads are not configured on this server")
	case errors.Is(err, storage.ErrContentType):
		return utils.Error(c, fiber.StatusUnsupportedMediaType, "Unsupported image type")
	case errors.Is(err, storage.ErrTooLarge):
		return utils.Error(c, fiber.StatusRequestEntityTooLarge, "Image larger than the allowed limit")
	case errors.Is(err, storage.ErrEmpty):
		return utils.Error(c, fiber.StatusBadRequest, "File size is required")
	case err != nil:
		return utils.Error(c, fiber.StatusInternalServerError, "Could not prepare the upload")
	}

	return utils.Success(c, fiber.StatusOK, fiber.Map{"upload": up})
}

// Limits tells the client whether the upload is available and with which limits.
// GET /api/uploads/limits
func (h *UploadHandler) Limits(c *fiber.Ctx) error {
	cfg := h.client.Config()
	tipos := make([]string, 0, len(storage.AllowedImageTypes))
	for ct := range storage.AllowedImageTypes {
		tipos = append(tipos, ct)
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{
		"enabled":   cfg.Enabled(),
		"max_bytes": cfg.MaxBytes,
		"types":     tipos,
	})
}
