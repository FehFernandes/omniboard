package server_test

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Testes do workspace: exigem o banco de teste (ver harness_test.go).
//
// What is protected here is silent loss of work: without a version, the second tab
// overwrote what the first one wrote and nobody found out.

func TestWorkspaceSavesAndLoadsBack(t *testing.T) {
	u := newUser(t)

	// The first GET creates the empty workspace.
	g := do(t, "GET", "/api/workspace", u.AccessToken, nil)
	require.Equal(t, 200, g.status, "%v", g.body)

	payload := map[string]any{"type": "omniboard-workspace-envelope", "version": 1, "meta": map[string]any{}}
	p := do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{"data": payload})
	require.Equal(t, 200, p.status, "%v", p.body)
	require.Equal(t, float64(2), num(p.body, "workspace", "version"), "the version advances on every save")

	g2 := do(t, "GET", "/api/workspace", u.AccessToken, nil)
	require.Equal(t, 200, g2.status)
	require.Equal(t, float64(2), num(g2.body, "workspace", "version"))
}

// Two tabs: the one arriving with a stale version is refused, not the winner.
func TestWorkspaceVersionConflict(t *testing.T) {
	u := newUser(t)
	do(t, "GET", "/api/workspace", u.AccessToken, nil)

	first := do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{
		"data":    map[string]any{"quem": "aba-1"},
		"version": 1,
	})
	require.Equal(t, 200, first.status, "%v", first.body)
	updated := num(first.body, "workspace", "version")
	require.Equal(t, float64(2), updated)

	// The second tab still thinks it is on version 1.
	segundo := do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{
		"data":    map[string]any{"quem": "aba-2"},
		"version": 1,
	})
	require.Equal(t, 409, segundo.status, "%v", segundo.body)
	require.Equal(t, true, segundo.body["conflict"], "the response has to be identifiable as a conflict")
	// The 409 returns the current state so the client reloads without another round trip.
	require.Equal(t, float64(2), num(segundo.body, "workspace", "version"))

	// And the first tab's data is still there — it was not overwritten.
	g := do(t, "GET", "/api/workspace", u.AccessToken, nil)
	data, ok := g.body["workspace"].(map[string]any)["data"].(map[string]any)
	require.True(t, ok, "%v", g.body)
	require.Equal(t, "aba-1", data["quem"])

	// With the correct version, the second tab writes.
	terceiro := do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{
		"data":    map[string]any{"quem": "aba-2"},
		"version": 2,
	})
	require.Equal(t, 200, terceiro.status, "%v", terceiro.body)
	require.Equal(t, float64(3), num(terceiro.body, "workspace", "version"))
}

// An older client (no version in the body) keeps working: we do not break open
// sessions when shipping this change.
func TestWorkspaceWithoutVersionSkipsTheCheck(t *testing.T) {
	u := newUser(t)
	do(t, "GET", "/api/workspace", u.AccessToken, nil)

	a := do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{"data": map[string]any{"n": 1}})
	require.Equal(t, 200, a.status)
	b := do(t, "PUT", "/api/workspace", u.AccessToken, map[string]any{"data": map[string]any{"n": 2}})
	require.Equal(t, 200, b.status, "without a version the save is not refused")
}

// Isolation: one user's workspace neither appears to nor is changed by another.
func TestWorkspaceOwnerIsolation(t *testing.T) {
	a := newUser(t)
	b := newUser(t)

	do(t, "GET", "/api/workspace", a.AccessToken, nil)
	do(t, "PUT", "/api/workspace", a.AccessToken, map[string]any{"data": map[string]any{"dono": "a"}})

	g := do(t, "GET", "/api/workspace", b.AccessToken, nil)
	require.Equal(t, 200, g.status)
	ws := g.body["workspace"].(map[string]any)
	require.Nil(t, ws["data"], "user B must not see user A's content")

	// B grava e A continua com o dele.
	do(t, "PUT", "/api/workspace", b.AccessToken, map[string]any{"data": map[string]any{"dono": "b"}})
	ga := do(t, "GET", "/api/workspace", a.AccessToken, nil)
	dataA := ga.body["workspace"].(map[string]any)["data"].(map[string]any)
	require.Equal(t, "a", dataA["dono"])
}

func TestWorkspaceRequiresAuthentication(t *testing.T) {
	require.Equal(t, 401, do(t, "GET", "/api/workspace", "", nil).status)
	require.Equal(t, 401, do(t, "PUT", "/api/workspace", "", map[string]any{"data": map[string]any{}}).status)
}
