package server_test

import (
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/FehFernandes/omniboard/internal/models"
	"github.com/FehFernandes/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
	"github.com/stretchr/testify/require"
)

// rawGetOn fires a GET without following redirects and returns the raw response —
// endpoints do fluxo OAuth respondem com 302 + Location + Set-Cookie, coisas que
// the `do` helper (which only decodes JSON) does not expose.
func rawGetOn(t *testing.T, a *fiber.App, path string, cookies map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, path, nil)
	require.NoError(t, err)
	for k, v := range cookies {
		req.AddCookie(&http.Cookie{Name: k, Value: v})
	}
	res, err := a.Test(req, 10000)
	require.NoError(t, err)
	return res
}

// oauthCookie extracts the state cookie set by /auth/google.
func oauthCookie(res *http.Response) *http.Cookie {
	for _, c := range res.Cookies() {
		if c.Name == "omniboard_oauth" {
			return c
		}
	}
	return nil
}

// ── Start of the flow ──

func TestGoogleStartRedirectsWithPKCE(t *testing.T) {
	res := rawGetOn(t, app, "/api/auth/google", nil)
	defer func() { _ = res.Body.Close() }()

	require.Equal(t, 302, res.StatusCode)

	loc, err := url.Parse(res.Header.Get("Location"))
	require.NoError(t, err)
	require.Equal(t, "accounts.google.com", loc.Host)

	q := loc.Query()
	require.Equal(t, "test-client-id.apps.googleusercontent.com", q.Get("client_id"))
	require.Equal(t, "code", q.Get("response_type"))
	require.Equal(t, "S256", q.Get("code_challenge_method"))
	require.NotEmpty(t, q.Get("code_challenge"))
	require.NotEmpty(t, q.Get("state"))
	require.Contains(t, q.Get("scope"), "openid")
	require.Equal(t, "http://localhost:4000/api/auth/google/callback", q.Get("redirect_uri"))

	// The state and code_verifier live in an HttpOnly cookie: the page's JS does not
	// need them, and the verifier must never be readable by the browser.
	ck := oauthCookie(res)
	require.NotNil(t, ck, "deveria setar o cookie de state")
	require.True(t, ck.HttpOnly, "the state cookie has to be HttpOnly")
	require.Contains(t, ck.Value, ".", "the cookie has to carry state.verifier")

	// The state in the URL has to match the one stored in the cookie (double-submit).
	require.True(t, len(ck.Value) > len(q.Get("state")))
	require.Equal(t, q.Get("state"), ck.Value[:len(q.Get("state"))])
}

// Two flow starts must not reuse the same state/verifier.
func TestGoogleStartGeneratesFreshStatePerCall(t *testing.T) {
	a := rawGetOn(t, app, "/api/auth/google", nil)
	defer func() { _ = a.Body.Close() }()
	b := rawGetOn(t, app, "/api/auth/google", nil)
	defer func() { _ = b.Body.Close() }()
	require.NotEqual(t, oauthCookie(a).Value, oauthCookie(b).Value)
}

// ── Callback: error paths (they never touch the network) ──

func TestGoogleCallbackRejectsStateWithoutCookie(t *testing.T) {
	res := rawGetOn(t, app, "/api/auth/google/callback?code=abc&state=xyz", nil)
	defer func() { _ = res.Body.Close() }()

	require.Equal(t, 302, res.StatusCode)
	require.Contains(t, res.Header.Get("Location"), "http://localhost:5173/auth/google/callback")
	require.Contains(t, res.Header.Get("Location"), "error=invalid_state")
}

func TestGoogleCallbackRejectsMismatchedState(t *testing.T) {
	res := rawGetOn(t, app, "/api/auth/google/callback?code=abc&state=not-the-cookie-one",
		map[string]string{"omniboard_oauth": "state-real.verifier-real"})
	defer func() { _ = res.Body.Close() }()

	require.Equal(t, 302, res.StatusCode)
	require.Contains(t, res.Header.Get("Location"), "error=invalid_state")
}

func TestGoogleCallbackHandlesDeniedConsent(t *testing.T) {
	res := rawGetOn(t, app, "/api/auth/google/callback?error=access_denied&state=xyz",
		map[string]string{"omniboard_oauth": "xyz.verifier"})
	defer func() { _ = res.Body.Close() }()

	require.Equal(t, 302, res.StatusCode)
	require.Contains(t, res.Header.Get("Location"), "error=consent_denied")
}

func TestGoogleCallbackRequiresCode(t *testing.T) {
	res := rawGetOn(t, app, "/api/auth/google/callback?state=xyz",
		map[string]string{"omniboard_oauth": "xyz.verifier"})
	defer func() { _ = res.Body.Close() }()

	require.Equal(t, 302, res.StatusCode)
	require.Contains(t, res.Header.Get("Location"), "error=missing_code")
}

// ── Exchanging the opaque code for the token pair (the only session issuer) ──

func TestGoogleExchangeIssuesTokensAndConsumesTheCode(t *testing.T) {
	u := newUserModel(t)
	code := newExchangeCode(t, u.ID, 5*time.Minute)

	r := do(t, "POST", "/api/auth/google/exchange", "", map[string]any{"code": code})
	require.Equal(t, 200, r.status, "body: %v", r.body)
	require.NotEmpty(t, str(r.body, "access_token"))
	require.NotEmpty(t, str(r.body, "refresh_token"))
	require.Equal(t, u.Email, str(r.body, "user", "email"))

	// O access token emitido tem de valer nas rotas protegidas.
	me := do(t, "GET", "/api/auth/me", str(r.body, "access_token"), nil)
	require.Equal(t, 200, me.status)

	// Single use: the same code must not produce a second session.
	again := do(t, "POST", "/api/auth/google/exchange", "", map[string]any{"code": code})
	require.Equal(t, 401, again.status, "the code should be single-use: %v", again.body)
}

func TestGoogleExchangeRejectsUnknownCode(t *testing.T) {
	r := do(t, "POST", "/api/auth/google/exchange", "", map[string]any{"code": "code-that-does-not-exist"})
	require.Equal(t, 401, r.status)
}

func TestGoogleExchangeRequiresCode(t *testing.T) {
	r := do(t, "POST", "/api/auth/google/exchange", "", map[string]any{})
	require.Equal(t, 400, r.status)
}

func TestGoogleExchangeRejectsExpiredCode(t *testing.T) {
	u := newUserModel(t)
	code := newExchangeCode(t, u.ID, -time.Minute) // born already expired

	r := do(t, "POST", "/api/auth/google/exchange", "", map[string]any{"code": code})
	require.Equal(t, 401, r.status)
}

// A token issued for another purpose cannot serve as a login code.
func TestGoogleExchangeRejectsTokenFromAnotherPurpose(t *testing.T) {
	u := newUserModel(t)
	raw, err := utils.SecureToken()
	require.NoError(t, err)
	require.NoError(t, db.Create(&models.VerificationToken{
		UserID:    u.ID,
		Purpose:   "outro_proposito",
		TokenHash: utils.HashToken(raw),
		ExpiresAt: time.Now().Add(time.Hour),
	}).Error)

	r := do(t, "POST", "/api/auth/google/exchange", "", map[string]any{"code": raw})
	require.Equal(t, 401, r.status)
}

func TestGoogleExchangeRefusesDisabledAccount(t *testing.T) {
	u := newUserModel(t)
	require.NoError(t, db.Model(u).Update("is_active", false).Error)
	code := newExchangeCode(t, u.ID, 5*time.Minute)

	r := do(t, "POST", "/api/auth/google/exchange", "", map[string]any{"code": code})
	require.Equal(t, 403, r.status)
}

// 2FA is the only possible extra step: with no password, it is the second factor on
// login com Google.
func TestGoogleExchangeRequires2FAWhenEnabled(t *testing.T) {
	u := newUserModel(t)
	secret, err := utils.GenerateTOTPSecret()
	require.NoError(t, err)
	now := time.Now()
	require.NoError(t, db.Model(u).Updates(map[string]any{
		"totp_secret": secret, "totp_enabled_at": now,
	}).Error)

	code := newExchangeCode(t, u.ID, 5*time.Minute)

	// No code: 401 signaling the second step (the code is NOT consumed).
	r := do(t, "POST", "/api/auth/google/exchange", "", map[string]any{"code": code})
	require.Equal(t, 401, r.status)
	require.Equal(t, true, r.body["two_factor_required"])

	// A wrong code does not consume it either.
	bad := do(t, "POST", "/api/auth/google/exchange", "", map[string]any{
		"code": code, "totp_code": "000000",
	})
	require.Equal(t, 401, bad.status)

	// With the correct TOTP the login completes — proving the code survived the
	// tentativas anteriores.
	valid, err := utils.TOTPCode(secret, time.Now())
	require.NoError(t, err)
	ok := do(t, "POST", "/api/auth/google/exchange", "", map[string]any{
		"code": code, "totp_code": valid,
	})
	require.Equal(t, 200, ok.status, "body: %v", ok.body)
	require.NotEmpty(t, str(ok.body, "access_token"))
}

// Disabling 2FA only requires the code (there is no password to re-authenticate).
func TestDisabling2FAOnlyNeedsTheCode(t *testing.T) {
	u := newUserModel(t)
	// The session is opened BEFORE enabling 2FA (otherwise exchange would ask for
	// the TOTP).
	acc := newSession(t, u)

	secret, err := utils.GenerateTOTPSecret()
	require.NoError(t, err)
	now := time.Now()
	require.NoError(t, db.Model(u).Updates(map[string]any{
		"totp_secret": secret, "totp_enabled_at": now,
	}).Error)

	ruim := do(t, "POST", "/api/auth/2fa/disable", acc.AccessToken, map[string]any{"code": "000000"})
	require.Equal(t, 401, ruim.status)

	current, err := utils.TOTPCode(secret, time.Now())
	require.NoError(t, err)
	ok := do(t, "POST", "/api/auth/2fa/disable", acc.AccessToken, map[string]any{"code": current})
	require.Equal(t, 200, ok.status, "body: %v", ok.body)

	me := do(t, "GET", "/api/auth/me", acc.AccessToken, nil)
	require.Equal(t, false, me.body["user"].(map[string]any)["two_factor_enabled"])
}

// ── Invariantes de banco ──

// The same Google `sub` cannot be linked to two accounts.
func TestGoogleIDIsUnique(t *testing.T) {
	u := newUserModel(t)
	sub := *u.GoogleID

	dup := models.User{
		Name: "Duplicata", Email: "dup" + uniq() + "@exemplo.com",
		IsActive: true, GoogleID: &sub,
	}
	require.Error(t, db.Create(&dup).Error, "a duplicate google_id should violate the unique index")
}

// Legacy accounts without a `sub` store NULL and do not collide in the unique
// index (in Postgres, NULLs are distinct from each other).
func TestAccountsWithoutGoogleIDDoNotCollide(t *testing.T) {
	for i := 0; i < 2; i++ {
		require.NoError(t, db.Create(&models.User{
			Name: "Sem Google", Email: "semgoogle" + uniq() + "@e.com", IsActive: true,
		}).Error)
	}
}
