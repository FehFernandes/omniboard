package server_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// A workspace with two boards: the shared one and one that must NOT show up.
func workspaceComDoisBoards(t *testing.T) map[string]any {
	t.Helper()
	return map[string]any{
		"type":    "omniboard-workspace-envelope",
		"version": 1,
		"workspace": map[string]any{
			"type":     "openboard-workspace",
			"version":  1,
			"activeId": "board-publico",
			"documents": []any{
				map[string]any{
					"id":   "board-publico",
					"name": "Arquitetura",
					"snapshot": map[string]any{
						"type":     "openboard",
						"version":  1,
						"elements": []any{map[string]any{"id": "el-1", "type": "rectangle"}},
					},
				},
				map[string]any{
					"id":   "board-privado",
					"name": "Segredos",
					"snapshot": map[string]any{
						"type":     "openboard",
						"version":  1,
						"elements": []any{map[string]any{"id": "el-secreto", "type": "text"}},
					},
				},
			},
		},
		"meta":     map[string]any{},
		"folders":  []any{},
		"comments": map[string]any{},
	}
}

func createShare(t *testing.T, tokenAuth, boardID, name string) map[string]any {
	t.Helper()
	r := do(t, "POST", "/api/shares", tokenAuth, map[string]any{
		"board_id": boardID, "board_name": name,
	})
	require.Equal(t, 201, r.status, "%v", r.body)
	return r.body["share"].(map[string]any)
}

func TestShareCreatesLinkAndServesTheBoard(t *testing.T) {
	u := newUser(t)
	do(t, "GET", "/api/workspace", u.AccessToken, nil)
	do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{
		"data": workspaceComDoisBoards(t),
	})

	share := createShare(t, u.AccessToken, "board-publico", "Arquitetura")
	token := share["token"].(string)
	// The token has to be long and unguessable.
	require.GreaterOrEqual(t, len(token), 40)
	require.NotContains(t, token, "+")
	require.NotContains(t, token, "/")

	// Public read: NO authentication.
	pub := do(t, "GET", "/api/public/shares/"+token, "", nil)
	require.Equal(t, 200, pub.status, "%v", pub.body)
	board := pub.body["board"].(map[string]any)
	require.Equal(t, "Arquitetura", board["name"])
	snap := board["snapshot"].(map[string]any)
	require.Equal(t, "openboard", snap["type"])
	require.Len(t, snap["elements"], 1)
}

// The central risk of this feature: sharing one board must not expose the others.
func TestPublicShareDoesNotLeakOtherBoards(t *testing.T) {
	u := newUser(t)
	do(t, "GET", "/api/workspace", u.AccessToken, nil)
	do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{
		"data": workspaceComDoisBoards(t),
	})
	share := createShare(t, u.AccessToken, "board-publico", "Arquitetura")

	pub := do(t, "GET", "/api/public/shares/"+share["token"].(string), "", nil)
	require.Equal(t, 200, pub.status)

	bruto := pub.raw
	require.NotContains(t, bruto, "board-privado")
	require.NotContains(t, bruto, "Segredos")
	require.NotContains(t, bruto, "el-secreto")
	// Nem dado do dono.
	require.NotContains(t, bruto, u.Email)
	require.NotContains(t, strings.ToLower(bruto), "user_id")
}

func TestShareTokenInvalidOrTooShort(t *testing.T) {
	require.Equal(t, 404, do(t, "GET", "/api/public/shares/abc", "", nil).status)
	require.Equal(t, 404, do(t, "GET", "/api/public/shares/"+strings.Repeat("x", 43), "", nil).status)
}

func TestRevokedShareStopsAnswering(t *testing.T) {
	u := newUser(t)
	do(t, "GET", "/api/workspace", u.AccessToken, nil)
	do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{"data": workspaceComDoisBoards(t)})
	share := createShare(t, u.AccessToken, "board-publico", "Arquitetura")
	token := share["token"].(string)

	require.Equal(t, 200, do(t, "GET", "/api/public/shares/"+token, "", nil).status)

	rev := do(t, "DELETE", "/api/shares/"+share["id"].(string), u.AccessToken, nil)
	require.Equal(t, 200, rev.status, "%v", rev.body)

	// 404 (not 403): we do not confirm that a dead link ever existed.
	require.Equal(t, 404, do(t, "GET", "/api/public/shares/"+token, "", nil).status)
}

// Clicking "share" twice must yield the SAME address.
func TestShareReusesExistingLink(t *testing.T) {
	u := newUser(t)
	a := createShare(t, u.AccessToken, "board-x", "Name A")

	r := do(t, "POST", "/api/shares", u.AccessToken, map[string]any{
		"board_id": "board-x", "board_name": "Name B",
	})
	require.Equal(t, 200, r.status, "%v", r.body)
	b := r.body["share"].(map[string]any)

	require.Equal(t, a["token"], b["token"], "the token must not change")
	require.Equal(t, "Name B", b["board_name"], "the name follows the board")
}

// Revoking and sharing again yields a NEW token (the old one does not come back).
func TestShareNewTokenAfterRevoking(t *testing.T) {
	u := newUser(t)
	do(t, "GET", "/api/workspace", u.AccessToken, nil)
	do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{"data": workspaceComDoisBoards(t)})

	a := createShare(t, u.AccessToken, "board-publico", "Arquitetura")
	do(t, "DELETE", "/api/shares/"+a["id"].(string), u.AccessToken, nil)

	b := createShare(t, u.AccessToken, "board-publico", "Arquitetura")
	require.NotEqual(t, a["token"], b["token"])
	require.Equal(t, 404, do(t, "GET", "/api/public/shares/"+a["token"].(string), "", nil).status)
	require.Equal(t, 200, do(t, "GET", "/api/public/shares/"+b["token"].(string), "", nil).status)
}

func TestShareListsOnlyYourOwn(t *testing.T) {
	a := newUser(t)
	b := newUser(t)
	createShare(t, a.AccessToken, "board-a", "A")
	createShare(t, b.AccessToken, "board-b", "B")

	l := do(t, "GET", "/api/shares", a.AccessToken, nil)
	require.Equal(t, 200, l.status)
	shares := l.body["shares"].([]any)
	require.Len(t, shares, 1)
	require.Equal(t, "board-a", shares[0].(map[string]any)["board_id"])
}

// Anti-IDOR: revoking another user's link must not work.
func TestShareCannotRevokeSomeoneElses(t *testing.T) {
	a := newUser(t)
	b := newUser(t)
	share := createShare(t, a.AccessToken, "board-a", "A")

	r := do(t, "DELETE", "/api/shares/"+share["id"].(string), b.AccessToken, nil)
	require.Equal(t, 404, r.status)

	// Continua ativo para o dono.
	l := do(t, "GET", "/api/shares", a.AccessToken, nil)
	require.Len(t, l.body["shares"].([]any), 1)
}

func TestShareRequiresAuthToManage(t *testing.T) {
	require.Equal(t, 401, do(t, "GET", "/api/shares", "", nil).status)
	require.Equal(t, 401, do(t, "POST", "/api/shares", "", map[string]any{"board_id": "x"}).status)
	require.Equal(t, 401, do(t, "DELETE", "/api/shares/algum-id", "", nil).status)
}

func TestShareRequiresBoardID(t *testing.T) {
	u := newUser(t)
	require.Equal(t, 400, do(t, "POST", "/api/shares", u.AccessToken, map[string]any{}).status)
}

// Board deleted from the workspace after being shared: the link answers 404 instead
// returning another board's content.
func TestPublicShareWithRemovedBoard(t *testing.T) {
	u := newUser(t)
	do(t, "GET", "/api/workspace", u.AccessToken, nil)
	do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{"data": workspaceComDoisBoards(t)})
	share := createShare(t, u.AccessToken, "board-publico", "Arquitetura")

	// Novo workspace sem o board compartilhado.
	do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{
		"data": map[string]any{
			"workspace": map[string]any{
				"documents": []any{map[string]any{"id": "other", "name": "Other", "snapshot": map[string]any{}}},
			},
		},
	})

	require.Equal(t, 404, do(t, "GET", "/api/public/shares/"+share["token"].(string), "", nil).status)
}

// View counter: the owner needs to know whether the link circulated.
func TestShareCountsViews(t *testing.T) {
	u := newUser(t)
	do(t, "GET", "/api/workspace", u.AccessToken, nil)
	do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{"data": workspaceComDoisBoards(t)})
	share := createShare(t, u.AccessToken, "board-publico", "Arquitetura")
	token := share["token"].(string)

	do(t, "GET", "/api/public/shares/"+token, "", nil)
	do(t, "GET", "/api/public/shares/"+token, "", nil)

	l := do(t, "GET", "/api/shares", u.AccessToken, nil)
	current := l.body["shares"].([]any)[0].(map[string]any)
	require.Equal(t, float64(2), current["views"])
}
