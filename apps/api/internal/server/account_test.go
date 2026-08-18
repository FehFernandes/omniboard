package server_test

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Profile update (name/avatar). It is the only account change possible: there is
// no password and the email belongs to the Google account.
func TestUpdateProfile(t *testing.T) {
	acc := newUser(t)

	u := do(t, "PUT", "/api/auth/me", acc.AccessToken, map[string]any{
		"name": "Updated Name", "avatar": "https://ex.com/a.png",
	})
	require.Equal(t, 200, u.status)
	require.Equal(t, "Updated Name", str(u.body, "user", "name"))

	me := do(t, "GET", "/api/auth/me", acc.AccessToken, nil)
	require.Equal(t, "Updated Name", str(me.body, "user", "name"))
	require.Equal(t, "https://ex.com/a.png", str(me.body, "user", "avatar"))

	require.Equal(t, 400, do(t, "PUT", "/api/auth/me", acc.AccessToken, map[string]any{"name": ""}).status)
}

// UpdateProfile is a whitelist: it must not allow changing the email nor the link
// to Google through this door.
func TestUpdateProfileDoesNotChangeEmail(t *testing.T) {
	acc := newUser(t)

	u := do(t, "PUT", "/api/auth/me", acc.AccessToken, map[string]any{
		"name": "Tentativa", "email": "invasor" + uniq() + "@e.com",
	})
	require.Equal(t, 200, u.status)
	require.Equal(t, acc.Email, str(u.body, "user", "email"), "the email cannot change through /auth/me")
}
