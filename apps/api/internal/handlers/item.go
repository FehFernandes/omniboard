package handlers

import (
	"github.com/FehFernandes/omniboard/internal/middleware"
	"github.com/FehFernandes/omniboard/internal/models"
	"github.com/FehFernandes/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

// ItemHandler groups the endpoints of the example resource.
type ItemHandler struct {
	db *gorm.DB
}

// NewItemHandler creates the items handler.
func NewItemHandler(db *gorm.DB) *ItemHandler {
	return &ItemHandler{db: db}
}

// scoped returns the base query already filtered by the owner (user_id from the token).
// Every read/write goes through here — it guarantees each user only sees what is theirs.
func (h *ItemHandler) scoped(c *fiber.Ctx) *gorm.DB {
	return h.db.Model(&models.Item{}).Where("user_id = ?", middleware.UserID(c))
}

// filtered applies the listing filters (status, search) over the query scoped by
// the owner. Separated so it can be reused by the page and the optional count.
func (h *ItemHandler) filtered(c *fiber.Ctx) *gorm.DB {
	q := h.scoped(c)
	if v := c.Query("status"); v != "" {
		q = q.Where("status = ?", v)
	}
	if s := c.Query("search"); s != "" {
		if tsq := utils.ToTSQuery(s); tsq != "" {
			// Indexed full-text (GIN) instead of ILIKE '%...%' (seq scan).
			q = q.Where("search_vector @@ to_tsquery('simple', ?)", tsq)
		}
	}
	return q
}

// List returns the user's items by cursor pagination (keyset).
//
// Query params: ?limit=20&cursor=<opaque>&status=...&search=...&count=true
//   - No COUNT by default (scale): it uses has_more by fetching limit+1 rows.
//   - ?count=true adds the exact total (use it only on small sets).
//
// GET /api/items
func (h *ItemHandler) List(c *fiber.Ctx) error {
	p := utils.ParsePage(c)
	q := h.filtered(c)

	// Cursor: continues from the last row (created_at, id) of the previous page.
	if p.Cursor != "" {
		if t, id, ok := utils.DecodeCursor(p.Cursor); ok {
			q = q.Where("(created_at, id) < (?, ?)", t, id)
		}
	}

	// Fetch limit+1 to know whether there is a next page without needing a COUNT.
	var items []models.Item
	if err := q.Order("created_at DESC, id DESC").Limit(p.Limit + 1).Find(&items).Error; err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not list the items")
	}

	hasMore := len(items) > p.Limit
	if hasMore {
		items = items[:p.Limit]
	}
	next := ""
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		next = utils.EncodeCursor(last.CreatedAt, last.ID)
	}

	resp := fiber.Map{"items": items, "has_more": hasMore, "next_cursor": next}

	// The exact total is optional (COUNT grows with the volume). Enable it only when needed.
	if c.QueryBool("count", false) {
		var total int64
		h.filtered(c).Count(&total)
		resp["total"] = total
	}
	return utils.Success(c, fiber.StatusOK, resp)
}

// Get returns a specific item (scoped by the owner).
// GET /api/items/:id
func (h *ItemHandler) Get(c *fiber.Ctx) error {
	var item models.Item
	if err := h.scoped(c).Where("id = ?", c.Params("id")).First(&item).Error; err != nil {
		return utils.FetchError(c, err, "Item not found")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"item": item})
}
