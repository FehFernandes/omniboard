package server_test

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func createItem(t *testing.T, token string, body map[string]any) resp {
	t.Helper()
	return do(t, "POST", "/api/items", token, body)
}

func TestItemCRUDLifecycle(t *testing.T) {
	u := newUser(t)

	c := createItem(t, u.AccessToken, map[string]any{"title": "First", "description": "desc"})
	require.Equal(t, 201, c.status, "%v", c.body)
	id := str(c.body, "item", "id")
	require.NotEmpty(t, id)

	g := do(t, "GET", "/api/items/"+id, u.AccessToken, nil)
	require.Equal(t, 200, g.status)
	require.Equal(t, "First", str(g.body, "item", "title"))

	up := do(t, "PUT", "/api/items/"+id, u.AccessToken, map[string]any{"title": "Atualizado", "status": "done"})
	require.Equal(t, 200, up.status)
	require.Equal(t, "Atualizado", str(up.body, "item", "title"))
	require.Equal(t, "done", str(up.body, "item", "status"))

	// List com total exato (opt-in via ?count=true)
	l := do(t, "GET", "/api/items?count=true", u.AccessToken, nil)
	require.Equal(t, 200, l.status)
	require.Equal(t, float64(1), num(l.body, "total"))
	require.Equal(t, false, l.body["has_more"])

	d := do(t, "DELETE", "/api/items/"+id, u.AccessToken, nil)
	require.Equal(t, 200, d.status)
	require.Equal(t, 404, do(t, "GET", "/api/items/"+id, u.AccessToken, nil).status)
}

func TestItemValidation(t *testing.T) {
	u := newUser(t)
	require.Equal(t, 400, createItem(t, u.AccessToken, map[string]any{"description": "sem titulo"}).status)
	require.Equal(t, 400, createItem(t, u.AccessToken, map[string]any{"title": "x", "status": "invalido"}).status)
}

// Per-user isolation: one user cannot reach another's items (anti-IDOR).
func TestItemUserIsolation(t *testing.T) {
	a := newUser(t)
	b := newUser(t)

	c := createItem(t, a.AccessToken, map[string]any{"title": "Only user A's"})
	require.Equal(t, 201, c.status)
	id := str(c.body, "item", "id")

	require.Equal(t, 404, do(t, "GET", "/api/items/"+id, b.AccessToken, nil).status)
	l := do(t, "GET", "/api/items?count=true", b.AccessToken, nil)
	require.Equal(t, float64(0), num(l.body, "total"))
	require.Equal(t, 404, do(t, "DELETE", "/api/items/"+id, b.AccessToken, nil).status)
}

// Full-text search: matches by word and by prefix, indexed (GIN).
func TestItemFullTextSearch(t *testing.T) {
	u := newUser(t)
	createItem(t, u.AccessToken, map[string]any{"title": "Planning meeting"})
	createItem(t, u.AccessToken, map[string]any{"title": "Shopping list", "description": "milk and bread"})
	createItem(t, u.AccessToken, map[string]any{"title": "Loose ideas"})

	r := do(t, "GET", "/api/items?search=plann&count=true", u.AccessToken, nil)
	require.Equal(t, 200, r.status)
	require.Equal(t, float64(1), num(r.body, "total"))

	r = do(t, "GET", "/api/items?search=milk&count=true", u.AccessToken, nil)
	require.Equal(t, float64(1), num(r.body, "total"))

	r = do(t, "GET", "/api/items?search=zzzznothing&count=true", u.AccessToken, nil)
	require.Equal(t, float64(0), num(r.body, "total"))
}

// Cursor pagination: walks every page without duplicating or skipping rows.
func TestItemCursorPagination(t *testing.T) {
	u := newUser(t)
	const n = 5
	for i := 0; i < n; i++ {
		require.Equal(t, 201, createItem(t, u.AccessToken, map[string]any{"title": "Item"}).status)
	}

	seen := map[string]bool{}
	cursor := ""
	pages := 0
	for {
		url := "/api/items?limit=2"
		if cursor != "" {
			url += "&cursor=" + cursor
		}
		r := do(t, "GET", url, u.AccessToken, nil)
		require.Equal(t, 200, r.status)
		items, _ := r.body["items"].([]any)
		for _, it := range items {
			m := it.(map[string]any)
			id := m["id"].(string)
			require.False(t, seen[id], "duplicate id across pages: %s", id)
			seen[id] = true
		}
		pages++
		require.LessOrEqual(t, pages, 10, "the pagination loop did not finish")
		if hm, _ := r.body["has_more"].(bool); !hm {
			break
		}
		cursor = str(r.body, "next_cursor")
		require.NotEmpty(t, cursor)
	}
	require.Equal(t, n, len(seen), "todas as linhas devem ser vistas exatamente uma vez")
}
