package utils

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

const (
	defaultLimit = 20
	maxLimit     = 100
)

// Page holds the cursor (keyset) pagination parameters.
//
// Why cursor and not OFFSET? A large OFFSET forces the database to scan and
// discard every previous row — it gets slow on deep pages. The cursor uses the
// position of the last row (created_at, id) to jump straight there, at constant cost.
type Page struct {
	Limit  int
	Cursor string
}

// ParsePage reads limit + cursor from the query string, with safe bounds.
func ParsePage(c *fiber.Ctx) Page {
	limit, _ := strconv.Atoi(c.Query("limit", strconv.Itoa(defaultLimit)))
	if limit < 1 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	return Page{Limit: limit, Cursor: c.Query("cursor")}
}

// EncodeCursor builds an opaque cursor from the row's (created_at, id) position.
func EncodeCursor(createdAt time.Time, id string) string {
	raw := fmt.Sprintf("%d|%s", createdAt.UTC().UnixNano(), id)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// DecodeCursor decodes a cursor. Returns ok=false if it is invalid.
func DecodeCursor(s string) (time.Time, string, bool) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return time.Time{}, "", false
	}
	parts := strings.SplitN(string(b), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, "", false
	}
	ns, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return time.Time{}, "", false
	}
	return time.Unix(0, ns).UTC(), parts[1], true
}
