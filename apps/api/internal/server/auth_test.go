package server_test

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// Regression on the core requirement: there is NO other way to sign in. If anyone
// reintroduces sign-up or password login, this test breaks.
//
// We do not assert 404: the authenticated group is mounted at /api with no prefix,
// so the auth middleware intercepts any unmatched path and answers 401 before
// Fiber's 404. What matters is that none of these routes issues a token.
func TestNoPasswordLoginPath(t *testing.T) {
	removidos := []struct {
		method, path string
	}{
		{"POST", "/api/auth/register"},
		{"POST", "/api/auth/login"},
		{"POST", "/api/auth/forgot-password"},
		{"POST", "/api/auth/reset-password"},
		{"POST", "/api/auth/verify-email"},
		{"POST", "/api/auth/change-password"},
		{"POST", "/api/auth/change-email"},
		{"POST", "/api/auth/resend-verification"},
		{"GET", "/api/auth/providers"},
	}
	for _, r := range removidos {
		t.Run(r.method+" "+r.path, func(t *testing.T) {
			got := do(t, r.method, r.path, "", map[string]any{
				"email": "a@b.com", "password": "Password@123",
			})
			require.Contains(t, []int{401, 404, 405}, got.status,
				"route %s should not exist (got %d: %v)", r.path, got.status, got.body)
			require.Empty(t, str(got.body, "access_token"),
				"route %s must not issue a token", r.path)
		})
	}
}

// The flip side: the Google flow is the only session issuer, and it is up.
func TestOnlySessionIssuerIsTheGoogleFlow(t *testing.T) {
	res := rawGetOn(t, app, "/api/auth/google", nil)
	defer func() { _ = res.Body.Close() }()
	require.Equal(t, 302, res.StatusCode, "Google login has to be available")
}

func TestRefreshTokenRotationAndRevocation(t *testing.T) {
	acc := newUser(t)

	r := do(t, "POST", "/api/auth/refresh", "", map[string]any{"refresh_token": acc.RefreshToken})
	require.Equal(t, 200, r.status)
	newRefresh := str(r.body, "refresh_token")
	require.NotEmpty(t, newRefresh)
	require.NotEqual(t, acc.RefreshToken, newRefresh, "the refresh token has to rotate")

	old := do(t, "POST", "/api/auth/refresh", "", map[string]any{"refresh_token": acc.RefreshToken})
	require.Equal(t, 401, old.status, "the old refresh must be rejected after rotation")
}

func TestRefreshRejectsInvalidToken(t *testing.T) {
	require.Equal(t, 401, do(t, "POST", "/api/auth/refresh", "",
		map[string]any{"refresh_token": "not-a-jwt"}).status)
}

func TestLogoutRevokesRefresh(t *testing.T) {
	acc := newUser(t)
	out := do(t, "POST", "/api/auth/logout", acc.AccessToken, nil)
	require.Equal(t, 200, out.status)

	r := do(t, "POST", "/api/auth/refresh", "", map[string]any{"refresh_token": acc.RefreshToken})
	require.Equal(t, 401, r.status)
}

func TestProtectedRequiresValidToken(t *testing.T) {
	require.Equal(t, 401, do(t, "GET", "/api/auth/me", "", nil).status)
	require.Equal(t, 401, do(t, "GET", "/api/auth/me", "token-invalido", nil).status)
}

// /me must not expose anything about passwords (the concept is gone).
func TestMeDoesNotExposePasswordFields(t *testing.T) {
	acc := newUser(t)
	me := do(t, "GET", "/api/auth/me", acc.AccessToken, nil)
	require.Equal(t, 200, me.status)

	user := me.body["user"].(map[string]any)
	for _, field := range []string{"password", "has_password", "auth_provider"} {
		_, exists := user[field]
		require.False(t, exists, "the response should not carry %q: %v", field, user)
	}
	require.Equal(t, acc.Email, user["email"])
}
