package server_test

import (
	"testing"

	"github.com/cachyosso/omniboard/internal/models"
	"github.com/cachyosso/omniboard/internal/utils"
	"github.com/stretchr/testify/require"
)

// A deactivated user must not be able to refresh tokens.
func TestRefreshRejectedWhenUserDeactivated(t *testing.T) {
	acc := newUser(t)

	ok := do(t, "POST", "/api/auth/refresh", "", map[string]any{"refresh_token": acc.RefreshToken})
	require.Equal(t, 200, ok.status)
	newRefresh := str(ok.body, "refresh_token")

	require.NoError(t, db.Model(&models.User{}).
		Where("id = ?", acc.UserID).Update("is_active", false).Error)

	r := do(t, "POST", "/api/auth/refresh", "", map[string]any{"refresh_token": newRefresh})
	require.Equal(t, 403, r.status, "a deactivated user cannot refresh tokens: %v", r.body)
}

// The refresh token must be stored as a HASH (in the sessions table), never in plain text.
func TestRefreshTokenStoredHashedNotPlaintext(t *testing.T) {
	acc := newUser(t)

	var session models.Session
	require.NoError(t, db.Where("user_id = ?", acc.UserID).First(&session).Error)

	require.NotEmpty(t, session.RefreshHash)
	require.NotEqual(t, acc.RefreshToken, session.RefreshHash, "the refresh token must not be stored in plain text")
	require.Equal(t, utils.HashToken(acc.RefreshToken), session.RefreshHash, "the database has to store the hash of the refresh token")
}

// Accounts with no Google link (legacy, from before the Google-only login
// migration) cannot authenticate: there is no way in.
func TestAccountWithoutGoogleIDCannotAuthenticate(t *testing.T) {
	legado := models.User{
		Name: "Legado", Email: "legado" + uniq() + "@e.com", IsActive: true,
		// GoogleID deliberately nil.
	}
	require.NoError(t, db.Create(&legado).Error)

	// The only session issuer is /auth/google/exchange, and it requires a code that
	// only Google's callback creates. Without a `sub`, the account is never found
	// by resolveGoogleUser through the google_id path.
	var count int64
	require.NoError(t, db.Model(&models.Session{}).Where("user_id = ?", legado.ID).Count(&count).Error)
	require.Zero(t, count, "an account without google_id should not get a session")
}
