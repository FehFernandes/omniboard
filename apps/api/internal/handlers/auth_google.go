package handlers

// Google login (OAuth 2.0 / OpenID Connect), Authorization Code + PKCE flow.
//
// This is the ONLY authentication path of the application: there is no signup
// and no password login. First-time visitors have their account created here.
//
// Why this design, and not the "Google button" that returns an ID token in the
// browser: here the client secret never leaves the backend, consent is a
// top-level navigation (no iframes, no blocked popups) and the end result is a
// token pair of the application's own — the rest of the app only knows the JWT.
//
// Steps:
//
//	1. GET  /api/auth/google           → generates state + PKCE, stores in an
//	                                     HttpOnly cookie and redirects to Google.
//	2. GET  /api/auth/google/callback  → validates the state, exchanges the code
//	                                     for an ID token, creates/finds the user
//	                                     and redirects to the front end with a
//	                                     single-use opaque code.
//	3. POST /api/auth/google/exchange  → exchanges that code for the token pair.
//
// Step 3 exists so the tokens do NOT travel in the redirect URL, where they
// would end up in the browser history, in the Referer header and in proxy logs.

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cachyosso/omniboard/internal/audit"
	"github.com/cachyosso/omniboard/internal/config"
	"github.com/cachyosso/omniboard/internal/models"
	"github.com/cachyosso/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

const (
	// oauthStateCookie holds the state (anti-CSRF) and the code_verifier (PKCE)
	// between the redirect to Google and the callback. HttpOnly: the page's JS does
	// not need — and must not — read the verifier.
	oauthStateCookie = "omniboard_oauth"

	// Window for the user to complete the consent at Google.
	oauthStateTTL = 10 * time.Minute

	// Lifetime of the opaque exchange code. Short, but enough for the front end to
	// load the callback page and, if there is 2FA, for the user to type the code.
	oauthExchangeTTL = 5 * time.Minute

	// Timeout of the server-to-server calls to Google.
	googleHTTPTimeout = 10 * time.Second
)

// googleHTTPClient is reused across requests (TLS connection pool) instead of
// opening a new transport at every login.
var googleHTTPClient = &http.Client{Timeout: googleHTTPTimeout}

// GoogleStart starts the flow: redirects to Google's consent screen.
// GET /api/auth/google  (public — top-level browser navigation)
func (h *AuthHandler) GoogleStart(c *fiber.Ctx) error {
	// state: random value returned by Google in the callback. Compared with the
	// copy in the cookie, it proves the callback belongs to a flow THIS browser
	// started (protection against login CSRF).
	state, err := utils.SecureToken()
	if err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not start the Google login")
	}
	// code_verifier (PKCE): guarantees that only whoever started the flow can
	// exchange the code for tokens, even if the code is intercepted in the redirect.
	verifier, err := utils.SecureToken()
	if err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not start the Google login")
	}

	c.Cookie(&fiber.Cookie{
		Name:     oauthStateCookie,
		Value:    state + "." + verifier,
		Path:     "/",
		HTTPOnly: true,
		Secure:   config.IsProduction(), // in dev the front end runs on http://localhost
		SameSite: "Lax",                 // Lax still sends the cookie on the redirect back (top-level GET)
		Expires:  time.Now().Add(oauthStateTTL),
	})

	challenge := sha256.Sum256([]byte(verifier))
	q := url.Values{
		"client_id":             {h.google.ClientID},
		"redirect_uri":          {h.google.RedirectURL},
		"response_type":         {"code"},
		"scope":                 {"openid email profile"},
		"state":                 {state},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method": {"S256"},
		// We only need to identify the user at login time; we do not keep Google
		// tokens to call APIs later — hence access_type=online.
		"access_type": {"online"},
		// Always show the account chooser: it avoids silently entering the wrong
		// Google account on shared machines.
		"prompt": {"select_account"},
	}
	return c.Redirect(config.GoogleAuthEndpoint+"?"+q.Encode(), fiber.StatusFound)
}

// GoogleCallback receives Google's return, resolves the user and hands control
// back to the front end with a single-use opaque code.
// GET /api/auth/google/callback  (public — called by Google's redirect)
func (h *AuthHandler) GoogleCallback(c *fiber.Ctx) error {
	// The state cookie is single-use: deleted now, whether it works out or not.
	cookie := c.Cookies(oauthStateCookie)
	h.clearOAuthStateCookie(c)

	// The user may have refused consent (error=access_denied).
	if reason := c.Query("error"); reason != "" {
		slog.Info("oauth google: consent was not granted", "reason", reason)
		return h.redirectGoogleError(c, "consent_denied")
	}

	state, verifier, ok := splitOAuthState(cookie)
	if !ok {
		return h.redirectGoogleError(c, "invalid_state")
	}
	// Constant-time comparison: the state is a session secret.
	if subtle.ConstantTimeCompare([]byte(state), []byte(c.Query("state"))) != 1 {
		return h.redirectGoogleError(c, "invalid_state")
	}

	code := c.Query("code")
	if code == "" {
		return h.redirectGoogleError(c, "missing_code")
	}

	profile, err := h.exchangeGoogleCode(c.Context(), code, verifier)
	if err != nil {
		slog.Error("oauth google: could not exchange the code", "err", err)
		return h.redirectGoogleError(c, "google_failed")
	}
	// Without a verified email there is no way to link the account safely: it would
	// be possible to claim someone else's email.
	if profile.Email == "" || !profile.EmailVerified {
		return h.redirectGoogleError(c, "email_unverified")
	}

	user, err := h.resolveGoogleUser(profile)
	if err != nil {
		slog.Error("oauth google: could not resolve the account", "err", err)
		return h.redirectGoogleError(c, "account_failed")
	}
	if !user.IsActive {
		return h.redirectGoogleError(c, "account_disabled")
	}

	exchange, err := h.createVerificationToken(user, models.PurposeOAuthExchange, oauthExchangeTTL)
	if err != nil {
		slog.Error("oauth google: could not create the exchange code", "err", err)
		return h.redirectGoogleError(c, "account_failed")
	}

	return c.Redirect(
		appURL()+"/auth/google/callback?code="+url.QueryEscape(exchange),
		fiber.StatusFound,
	)
}

type googleExchangeRequest struct {
	Code     string `json:"code"`
	TOTPCode string `json:"totp_code"`
}

// GoogleExchange exchanges the opaque code from the callback for the
// application's token pair, creating a session like any other login.
// POST /api/auth/google/exchange  (public)
func (h *AuthHandler) GoogleExchange(c *fiber.Ctx) error {
	var req googleExchangeRequest
	if err := c.BodyParser(&req); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if req.Code == "" {
		return utils.Error(c, fiber.StatusBadRequest, "Code is required")
	}

	var vt models.VerificationToken
	err := h.db.Where("token_hash = ? AND purpose = ?",
		utils.HashToken(req.Code), models.PurposeOAuthExchange).First(&vt).Error
	if err != nil || !vt.IsUsable() {
		return utils.Error(c, fiber.StatusUnauthorized, "Invalid or expired code")
	}

	var user models.User
	if err := h.db.First(&user, "id = ?", vt.UserID).Error; err != nil {
		return utils.Error(c, fiber.StatusUnauthorized, "User not found")
	}
	if !user.IsActive {
		return utils.Error(c, fiber.StatusForbidden, "User is deactivated")
	}

	// 2FA applies to the social login too. Without this gate, whoever enabled 2FA
	// could bypass it by entering through Google — the second step would stop
	// existing in practice. The code is only consumed after 2FA passes, so the
	// user can try again if they get the TOTP wrong.
	if user.TwoFactorEnabled() {
		if req.TOTPCode == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"success": false, "error": "2FA code required", "two_factor_required": true,
			})
		}
		if !h.verifyTwoFactor(&user, req.TOTPCode) {
			return utils.Error(c, fiber.StatusUnauthorized, "Invalid 2FA code")
		}
	}

	// Atomic consumption: the UPDATE conditioned on used_at IS NULL guarantees that
	// two concurrent requests with the same code do not generate two sessions.
	res := h.db.Model(&models.VerificationToken{}).
		Where("id = ? AND used_at IS NULL", vt.ID).
		Update("used_at", time.Now())
	if res.Error != nil || res.RowsAffected == 0 {
		return utils.Error(c, fiber.StatusUnauthorized, "Invalid or expired code")
	}

	audit.Record(h.db, models.AuditLog{
		ActorUserID: &user.ID, ActorEmail: user.Email,
		Action: audit.ActionLogin, TargetType: "user", TargetID: user.ID, IP: c.IP(),
	})

	return h.issueTokens(c, &user, fiber.StatusOK, nil)
}

// ── Interaction with Google ──

// googleProfile are the ID token claims we care about.
type googleProfile struct {
	Sub           string `json:"sub"` // stable identifier of the user at Google
	Aud           string `json:"aud"`
	Iss           string `json:"iss"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

// exchangeGoogleCode exchanges the authorization code for the ID token and
// returns the user's profile.
func (h *AuthHandler) exchangeGoogleCode(ctx context.Context, code, verifier string) (*googleProfile, error) {
	form := url.Values{
		"code":          {code},
		"client_id":     {h.google.ClientID},
		"client_secret": {h.google.ClientSecret},
		"redirect_uri":  {h.google.RedirectURL},
		"grant_type":    {"authorization_code"},
		"code_verifier": {verifier},
	}

	reqCtx, cancel := context.WithTimeout(ctx, googleHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost,
		config.GoogleTokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := googleHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = res.Body.Close() }()

	// LimitReader: third-party response, we do not trust the announced size.
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		// We do not log the body: it may echo the code/client_secret we sent.
		return nil, fmt.Errorf("endpoint de token do Google respondeu %d", res.StatusCode)
	}

	var tok struct {
		IDToken string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return nil, fmt.Errorf("unreadable response from Google: %w", err)
	}
	if tok.IDToken == "" {
		return nil, errors.New("Google response has no id_token")
	}

	profile, err := decodeGoogleIDToken(tok.IDToken)
	if err != nil {
		return nil, err
	}
	// Defense in depth: the token must have been issued by Google FOR this client.
	// It blocks a valid token from another app that got injected here.
	if profile.Aud != h.google.ClientID {
		return nil, errors.New("id_token issued for another client_id")
	}
	if !isGoogleIssuer(profile.Iss) {
		return nil, fmt.Errorf("id_token com issuer inesperado: %q", profile.Iss)
	}
	return profile, nil
}

// decodeGoogleIDToken reads the claims from an ID token's payload.
//
// The signature is NOT verified, and that is safe IN THIS flow: the token was
// just fetched by the backend itself from Google's token endpoint, over HTTPS
// and authenticating with the client_secret. There is no intermediary able to
// forge it. Verification by JWKS is necessary in the opposite case — when the ID
// token arrives through an untrusted path, such as sent by the browser. It is
// the same guidance from Google's documentation for the server-side flow:
// https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo
func decodeGoogleIDToken(idToken string) (*googleProfile, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return nil, errors.New("id_token malformado")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("unreadable id_token payload: %w", err)
	}
	var p googleProfile
	if err := json.Unmarshal(payload, &p); err != nil {
		return nil, fmt.Errorf("unreadable id_token claims: %w", err)
	}
	if p.Sub == "" {
		return nil, errors.New("id_token sem a claim sub")
	}
	return &p, nil
}

func isGoogleIssuer(iss string) bool {
	for _, valid := range config.GoogleIssuers {
		if iss == valid {
			return true
		}
	}
	return false
}

// ── Local account resolution ──

// resolveGoogleUser finds, links or creates the account corresponding to the
// Google profile.
func (h *AuthHandler) resolveGoogleUser(p *googleProfile) (*models.User, error) {
	email := utils.SanitizeEmail(p.Email)
	now := time.Now()
	sub := p.Sub

	// 1) Account already linked by `sub`: the normal re-login path.
	var user models.User
	err := h.db.Where("google_id = ?", sub).First(&user).Error
	switch {
	case err == nil:
		updates := map[string]any{}
		// The Google email may have changed since the last login.
		if user.Email != email {
			updates["email"] = email
		}
		// We do not overwrite an avatar the user has already set.
		if user.Avatar == "" && p.Picture != "" {
			updates["avatar"] = truncate(p.Picture, 500)
		}
		if len(updates) > 0 {
			if err := h.db.Model(&user).Updates(updates).Error; err != nil {
				// Email collision (another account already uses the new address): the
				// login proceeds with the current data instead of blocking the user.
				slog.Warn("oauth google: could not sync the profile", "err", err)
			}
		}
		return &user, nil
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return nil, err
	}

	// 2) Local account with the same email: link instead of creating a duplicate.
	// It is safe because Google already confirmed email ownership (email_verified);
	// whoever controls the email could already take the account via "forgot password".
	err = h.db.Where("email = ?", email).First(&user).Error
	switch {
	case err == nil:
		updates := map[string]any{"google_id": sub}
		if user.EmailVerifiedAt == nil {
			updates["email_verified_at"] = now
		}
		if user.Avatar == "" && p.Picture != "" {
			updates["avatar"] = truncate(p.Picture, 500)
		}
		if err := h.db.Model(&user).Updates(updates).Error; err != nil {
			return nil, err
		}
		user.GoogleID = &sub
		return &user, nil
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return nil, err
	}

	// 3) First access: create the account. It is born with no local password
	// (Password empty) and with the email already verified — Google just attested it.
	name := utils.SanitizeString(p.Name)
	if name == "" {
		name = email
	}
	user = models.User{
		Name:            truncate(name, 150),
		Email:           email,
		Avatar:          truncate(p.Picture, 500),
		IsActive:        true,
		EmailVerifiedAt: &now,
		GoogleID:        &sub,
	}
	if err := h.db.Create(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// ── Helpers ──

// splitOAuthState splits the "state.verifier" cookie. Returns ok=false if the
// cookie is absent or malformed.
func splitOAuthState(cookie string) (state, verifier string, ok bool) {
	state, verifier, ok = strings.Cut(cookie, ".")
	if !ok || state == "" || verifier == "" {
		return "", "", false
	}
	return state, verifier, true
}

func (h *AuthHandler) clearOAuthStateCookie(c *fiber.Ctx) {
	c.Cookie(&fiber.Cookie{
		Name:     oauthStateCookie,
		Value:    "",
		Path:     "/",
		HTTPOnly: true,
		Secure:   config.IsProduction(),
		SameSite: "Lax",
		Expires:  time.Now().Add(-time.Hour),
	})
}

// redirectGoogleError sends the user back to the front end with a stable reason
// (a key, not a phrase) for the callback page to translate. OAuth errors happen
// in the middle of a browser redirect: showing raw JSON on screen would be useless.
func (h *AuthHandler) redirectGoogleError(c *fiber.Ctx, reason string) error {
	return c.Redirect(
		appURL()+"/auth/google/callback?error="+url.QueryEscape(reason),
		fiber.StatusFound,
	)
}

// truncate cuts the string to at most n bytes, respecting the limits of the
// database columns (Google does not promise a maximum size for name/photo).
// Since varchar(n) in Postgres counts characters, limiting by bytes is conservative.
func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	// Back off to a rune boundary: cutting in the middle of a multibyte
	// character (accent, emoji) would produce invalid UTF-8.
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
