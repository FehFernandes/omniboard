package server_test

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestBoardCRUD(t *testing.T) {
	u := newUser(t)

	c := do(t, "POST", "/api/boards", u.AccessToken, map[string]any{"title": "First", "description": "desc"})
	require.Equal(t, 201, c.status, "%v", c.body)
	id := str(c.body, "board", "id")
	require.NotEmpty(t, id)

	g := do(t, "GET", "/api/boards/"+id, u.AccessToken, nil)
	require.Equal(t, 200, g.status)

	up := do(t, "PUT", "/api/boards/"+id, u.AccessToken, map[string]any{"title": "Atualizado", "status": "done"})
	require.Equal(t, 200, up.status)
	require.Equal(t, "Atualizado", str(up.body, "board", "title"))

	l := do(t, "GET", "/api/boards?count=true", u.AccessToken, nil)
	require.Equal(t, 200, l.status)
	require.Equal(t, float64(1), num(l.body, "total"))

	d := do(t, "DELETE", "/api/boards/"+id, u.AccessToken, nil)
	require.Equal(t, 200, d.status)
	require.Equal(t, 404, do(t, "GET", "/api/boards/"+id, u.AccessToken, nil).status)
}

func TestBoardValidation(t *testing.T) {
	u := newUser(t)
	require.Equal(t, 400, do(t, "POST", "/api/boards", u.AccessToken, map[string]any{"description": "sem titulo"}).status)
}

// Ownership isolation: one user's record is invisible to another (anti-IDOR).
func TestBoardUserIsolation(t *testing.T) {
	a := newUser(t)
	b := newUser(t)

	c := do(t, "POST", "/api/boards", a.AccessToken, map[string]any{"title": "Only user A's"})
	require.Equal(t, 201, c.status)
	id := str(c.body, "board", "id")

	require.Equal(t, 404, do(t, "GET", "/api/boards/"+id, b.AccessToken, nil).status)
}
