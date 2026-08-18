package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"

	"github.com/FehFernandes/omniboard/internal/middleware"
	"github.com/FehFernandes/omniboard/internal/models"
	"github.com/FehFernandes/omniboard/internal/utils"
)

// ShareHandler creates, lists and revokes public read links, and serves the
// shared board to whoever holds the token.
type ShareHandler struct {
	db *gorm.DB
}

func NewShareHandler(db *gorm.DB) *ShareHandler {
	return &ShareHandler{db: db}
}

// newToken generates the credential of the public URL.
//
// 32 bytes of cryptographic randomness in base64url: unguessable by brute
// force and safe in a URL (no +, / or =).
func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

type shareInput struct {
	// Id of the document inside the workspace (BoardManager nanoid).
	BoardID string `json:"board_id"`
	// Current name, only so the owner's list of links stays readable.
	BoardName string `json:"board_name"`
}

// Create creates (or reuses) the public link of a board.
//
// Reusing is intentional: clicking "share" twice must give the same address,
// not scatter different tokens for the same board.
//
// POST /api/shares
func (h *ShareHandler) Create(c *fiber.Ctx) error {
	uid := middleware.UserID(c)
	var in shareInput
	if err := c.BodyParser(&in); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if in.BoardID == "" {
		return utils.Error(c, fiber.StatusBadRequest, "board_id is required")
	}

	var existente models.BoardShare
	err := h.db.Where("user_id = ? AND board_id = ? AND revoked_at IS NULL", uid, in.BoardID).
		First(&existente).Error
	if err == nil {
		// Keeps the name up to date, but the token stays the same.
		if in.BoardName != "" && in.BoardName != existente.BoardName {
			h.db.Model(&existente).Update("board_name", in.BoardName)
			existente.BoardName = in.BoardName
		}
		return utils.Success(c, fiber.StatusOK, fiber.Map{"share": existente})
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not load the links")
	}

	token, err := newToken()
	if err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not generate the link")
	}
	share := models.BoardShare{
		UserID:    uid,
		BoardID:   in.BoardID,
		BoardName: in.BoardName,
		Token:     token,
	}
	if err := h.db.Create(&share).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not create the link")
	}
	return utils.Success(c, fiber.StatusCreated, fiber.Map{"share": share})
}

// List returns the user's active links.
// GET /api/shares
func (h *ShareHandler) List(c *fiber.Ctx) error {
	var shares []models.BoardShare
	if err := h.db.
		Where("user_id = ? AND revoked_at IS NULL", middleware.UserID(c)).
		Order("created_at DESC").
		Find(&shares).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not list the links")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"shares": shares})
}

// Revoke turns the link off. The row stays (see models.BoardShare).
// DELETE /api/shares/:id
func (h *ShareHandler) Revoke(c *fiber.Ctx) error {
	uid := middleware.UserID(c)
	var share models.BoardShare
	if err := h.db.Where("id = ? AND user_id = ?", c.Params("id"), uid).First(&share).Error; err != nil {
		return utils.FetchError(c, err, "Link not found")
	}
	now := time.Now()
	if err := h.db.Model(&share).Update("revoked_at", now).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not revoke the link")
	}
	share.RevokedAt = &now
	return utils.Success(c, fiber.StatusOK, fiber.Map{"share": share})
}

// Public serves the shared board. WITHOUT authentication: the token is the credential.
//
// It returns only the shared document — never the whole workspace, never data
// of the owner. A bug here would leak every board of whoever shared one.
//
// GET /api/public/shares/:token
func (h *ShareHandler) Public(c *fiber.Ctx) error {
	token := c.Params("token")
	if len(token) < 20 {
		return utils.Error(c, fiber.StatusNotFound, "Invalid or expired link")
	}

	var share models.BoardShare
	if err := h.db.Where("token = ? AND revoked_at IS NULL", token).First(&share).Error; err != nil {
		// 404 for revoked too: we do not confirm the existence of a dead link.
		return utils.Error(c, fiber.StatusNotFound, "Invalid or expired link")
	}

	var ws models.Workspace
	if err := h.db.Where("user_id = ?", share.UserID).First(&ws).Error; err != nil {
		return utils.Error(c, fiber.StatusNotFound, "Board not found")
	}

	doc, name, err := extractDocument(ws.Data, share.BoardID)
	if err != nil {
		return utils.Error(c, fiber.StatusNotFound, "Board not found")
	}
	if name == "" {
		name = share.BoardName
	}

	// The access count is a side effect: it must not bring the read down.
	now := time.Now()
	h.db.Model(&models.BoardShare{}).Where("id = ?", share.ID).
		Updates(map[string]any{"views": gorm.Expr("views + 1"), "last_view_at": now})

	return utils.Success(c, fiber.StatusOK, fiber.Map{
		"board": fiber.Map{
			"name":     name,
			"snapshot": doc,
		},
	})
}

// extractDocument finds a board inside the workspace envelope.
//
// The format is what the client writes: an envelope
// { workspace: { documents: [{ id, name, snapshot }] } }, or the raw BoardManager
// snapshot (old format). We work with map[string]any on purpose: mirroring the
// client structs here would create two places to keep in sync.
func extractDocument(payload []byte, boardID string) (snapshot any, name string, err error) {
	if len(payload) == 0 {
		return nil, "", errors.New("empty workspace")
	}
	var raiz map[string]any
	if err := json.Unmarshal(payload, &raiz); err != nil {
		return nil, "", err
	}

	// The application envelope wraps the BoardManager snapshot.
	ws := raiz
	if inner, ok := raiz["workspace"].(map[string]any); ok {
		ws = inner
	}

	docs, ok := ws["documents"].([]any)
	if !ok {
		return nil, "", errors.New("workspace sem documents")
	}
	for _, d := range docs {
		doc, ok := d.(map[string]any)
		if !ok {
			continue
		}
		if id, _ := doc["id"].(string); id == boardID {
			name, _ = doc["name"].(string)
			return doc["snapshot"], name, nil
		}
	}
	return nil, "", errors.New("the board is not in the workspace")
}
