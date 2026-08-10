package handlers

import (
	"github.com/cachyosso/omniboard/internal/middleware"
	"github.com/cachyosso/omniboard/internal/models"
	"github.com/cachyosso/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

// BoardHandler groups the endpoints of the Board resource.
type BoardHandler struct {
	db *gorm.DB
}

// NewBoardHandler creates the handler.
func NewBoardHandler(db *gorm.DB) *BoardHandler {
	return &BoardHandler{db: db}
}

// scoped returns the base query ALREADY filtered by the owner (user_id from the token).
// Every read/write goes through here — do not remove that filter (it is the anti-leak barrier).
func (h *BoardHandler) scoped(c *fiber.Ctx) *gorm.DB {
	return h.db.Model(&models.Board{}).Where("user_id = ?", middleware.UserID(c))
}

// filtered applies the listing filters (status, search) over the scoped query.
func (h *BoardHandler) filtered(c *fiber.Ctx) *gorm.DB {
	q := h.scoped(c)
	if v := c.Query("status"); v != "" {
		q = q.Where("status = ?", v)
	}
	if s := c.Query("search"); s != "" {
		if tsq := utils.ToTSQuery(s); tsq != "" {
			q = q.Where("search_vector @@ to_tsquery('simple', ?)", tsq)
		}
	}
	return q
}

// List returns board by cursor pagination (keyset).
// GET /api/boards
func (h *BoardHandler) List(c *fiber.Ctx) error {
	p := utils.ParsePage(c)
	q := h.filtered(c)

	if p.Cursor != "" {
		if t, id, ok := utils.DecodeCursor(p.Cursor); ok {
			q = q.Where("(created_at, id) < (?, ?)", t, id)
		}
	}

	var records []models.Board
	if err := q.Omit("data").Order("created_at DESC, id DESC").Limit(p.Limit + 1).Find(&records).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not list the boards")
	}

	hasMore := len(records) > p.Limit
	if hasMore {
		records = records[:p.Limit]
	}
	next := ""
	if hasMore && len(records) > 0 {
		last := records[len(records)-1]
		next = utils.EncodeCursor(last.CreatedAt, last.ID)
	}

	resp := fiber.Map{"boards": records, "has_more": hasMore, "next_cursor": next}
	if c.QueryBool("count", false) {
		var total int64
		h.filtered(c).Count(&total)
		resp["total"] = total
	}
	return utils.Success(c, fiber.StatusOK, resp)
}

// Get returns a specific record (scoped).
// GET /api/boards/:id
func (h *BoardHandler) Get(c *fiber.Ctx) error {
	var record models.Board
	if err := h.scoped(c).Where("id = ?", c.Params("id")).First(&record).Error; err != nil {
		return utils.FetchError(c, err, "Board not found")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"board": record})
}
