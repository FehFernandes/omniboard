package server_test

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Multiple devices: logging out of one session does not affect the others.
func TestMultiDeviceLogoutIsolated(t *testing.T) {
	u := newUserModel(t)
	dev1 := newSession(t, u)
	dev2 := newSession(t, u)
	require.NotEqual(t, dev1.RefreshToken, dev2.RefreshToken)

	require.Equal(t, 200, do(t, "POST", "/api/auth/logout", dev1.AccessToken, nil).status)

	require.Equal(t, 401, do(t, "POST", "/api/auth/refresh", "", map[string]any{"refresh_token": dev1.RefreshToken}).status)
	require.Equal(t, 200, do(t, "POST", "/api/auth/refresh", "", map[string]any{"refresh_token": dev2.RefreshToken}).status)
}

// logout-all terminates every session of the user.
func TestLogoutAllRevokesEverySession(t *testing.T) {
	u := newUserModel(t)
	dev1 := newSession(t, u)
	dev2 := newSession(t, u)

	require.Equal(t, 200, do(t, "POST", "/api/auth/logout-all", dev1.AccessToken, nil).status)

	require.Equal(t, 401, do(t, "POST", "/api/auth/refresh", "", map[string]any{"refresh_token": dev1.RefreshToken}).status)
	require.Equal(t, 401, do(t, "POST", "/api/auth/refresh", "", map[string]any{"refresh_token": dev2.RefreshToken}).status)
}

// Each Google login opens a new session without dropping the previous ones.
func TestEachLoginOpensANewSession(t *testing.T) {
	u := newUserModel(t)
	dev1 := newSession(t, u)
	dev2 := newSession(t, u)
	dev3 := newSession(t, u)

	for _, acc := range []account{dev1, dev2, dev3} {
		require.Equal(t, 200, do(t, "GET", "/api/auth/me", acc.AccessToken, nil).status)
	}
}
