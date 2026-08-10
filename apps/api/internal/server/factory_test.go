package server_test

import (
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cachyosso/omniboard/internal/models"
	"github.com/cachyosso/omniboard/internal/utils"
	"github.com/stretchr/testify/require"
)

var seq int64

// uniq generates a unique suffix per call (avoids email collisions across tests).
func uniq() string {
	return fmt.Sprintf("%d", atomic.AddInt64(&seq, 1))
}

// account represents an authenticated user returned by the factory.
type account struct {
	AccessToken  string
	RefreshToken string
	UserID       string
	Email        string
}

// newUserModel inserts straight into the database the account the Google callback
// would produce. Going straight to the database is deliberate: walking the full
// flow would require talking to the real accounts.google.com, which does not
// belong in a test.
func newUserModel(t *testing.T) *models.User {
	t.Helper()
	id := uniq()
	verified := time.Now()
	sub := "google-sub-" + id
	u := &models.User{
		Name:            "User " + id,
		Email:           "user" + id + "@exemplo.com",
		IsActive:        true,
		EmailVerifiedAt: &verified,
		GoogleID:        &sub,
	}
	require.NoError(t, db.Create(u).Error)
	return u
}

// newExchangeCode creates the single-use opaque code the callback hands to the
// frontend at the end of the OAuth flow.
func newExchangeCode(t *testing.T, userID string, ttl time.Duration) string {
	t.Helper()
	raw, err := utils.SecureToken()
	require.NoError(t, err)
	vt := models.VerificationToken{
		UserID:    userID,
		Purpose:   models.PurposeOAuthExchange,
		TokenHash: utils.HashToken(raw),
		ExpiresAt: time.Now().Add(ttl),
	}
	require.NoError(t, db.Create(&vt).Error)
	return raw
}

// newSession completes a login for an existing user and returns the tokens.
// Call it twice with the same user to simulate multiple devices.
func newSession(t *testing.T, u *models.User) account {
	t.Helper()
	code := newExchangeCode(t, u.ID, 5*time.Minute)
	r := do(t, "POST", "/api/auth/google/exchange", "", map[string]any{"code": code})
	if r.status != 200 {
		t.Fatalf("newSession: esperava 200, veio %d: %v", r.status, r.body)
	}
	return account{
		AccessToken:  str(r.body, "access_token"),
		RefreshToken: str(r.body, "refresh_token"),
		UserID:       u.ID,
		Email:        u.Email,
	}
}

// newUser creates a fresh account (as on a first Google login) and returns an
// authenticated session.
func newUser(t *testing.T) account {
	t.Helper()
	return newSession(t, newUserModel(t))
}
