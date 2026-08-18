package config

import (
	"log"
	"os"
	"strings"
)

// Google OpenID Connect endpoints. Fixed and public — declared here so we do
// not spread magic URLs across the handlers.
const (
	GoogleAuthEndpoint  = "https://accounts.google.com/o/oauth2/v2/auth"
	GoogleTokenEndpoint = "https://oauth2.googleapis.com/token"
)

// GoogleIssuers are the accepted values for the `iss` claim of a Google ID
// token. Both forms are issued in practice.
var GoogleIssuers = []string{"accounts.google.com", "https://accounts.google.com"}

// GoogleOAuth are the credentials of the OAuth Client used at login.
//
// "Sign in with Google" is the ONLY form of authentication in this application:
// there is no signup and no password login. That is why these credentials are
// mandatory — without them the server has no way to authenticate anyone and
// stops at boot, instead of answering with a runtime error.
//
// IMPORTANT: they do NOT come from the gcloud CLI. The gcloud login authenticates
// *you* against Google's APIs; to authenticate the app's *users* you need an
// OAuth Client of type "Web application", created in the Google Cloud Console
// (APIs & Services → Credentials → Create OAuth client ID), with the Authorized
// redirect URI pointing to GOOGLE_REDIRECT_URL. See .env.example.
type GoogleOAuth struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

// LoadGoogleOAuth loads the credentials from the environment. Fatal failure if
// absent, in the same spirit as LoadJWTConfig: an incomplete authentication
// configuration has to show up at boot, not at the first login.
func LoadGoogleOAuth() *GoogleOAuth {
	cfg := &GoogleOAuth{
		ClientID:     strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")),
		ClientSecret: strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_SECRET")),
		RedirectURL:  strings.TrimRight(strings.TrimSpace(os.Getenv("GOOGLE_REDIRECT_URL")), "/"),
	}
	if cfg.ClientID == "" || cfg.ClientSecret == "" {
		log.Fatal("FATAL: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required — " +
			"Google login is the only way to authenticate. " +
			"Crie um OAuth Client (Web application) em https://console.cloud.google.com/apis/credentials")
	}
	if cfg.RedirectURL == "" {
		cfg.RedirectURL = APIURL() + "/api/auth/google/callback"
	}
	return cfg
}

// APIURL returns the public URL of this API, without a trailing slash.
func APIURL() string {
	return strings.TrimRight(getEnv("API_URL", "http://localhost:4000"), "/")
}
