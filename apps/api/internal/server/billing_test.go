package server_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// The plan catalog is public (pricing) and reports the active provider.
func TestBillingPlansPublic(t *testing.T) {
	r := do(t, "GET", "/api/billing/plans", "", nil)
	require.Equal(t, 200, r.status, "%v", r.body)
	require.Equal(t, "fake", str(r.body, "provider"))
	plans, _ := r.body["plans"].([]any)
	require.NotEmpty(t, plans)
}

// Fluxo completo com o provedor FAKE: default free → checkout pro →
// completion (dev/complete) → active subscription (scoped to the user).
func TestBillingFakeCheckoutFlow(t *testing.T) {
	u := newUser(t)

	// Default subscription (no record): free / inactive.
	s := do(t, "GET", "/api/billing/subscription", u.AccessToken, nil)
	require.Equal(t, 200, s.status, "%v", s.body)
	require.Equal(t, "free", str(s.body, "subscription", "plan"))
	require.Equal(t, "inactive", str(s.body, "subscription", "status"))

	// Starts the checkout for the pro plan.
	co := do(t, "POST", "/api/billing/checkout", u.AccessToken, map[string]any{"plan": "pro"})
	require.Equal(t, 200, co.status, "%v", co.body)
	url := str(co.body, "checkout_url")
	require.Contains(t, url, "/api/billing/dev/complete")
	require.Contains(t, url, "plan=pro")

	// Conclui o checkout fake (endpoint dev) — responde 302 (redirect p/ success).
	path := strings.TrimPrefix(url, "http://localhost:4000")
	done := do(t, "GET", path, "", nil)
	require.Equal(t, 302, done.status, "%v", done.body)

	// The subscription is now active on pro.
	s2 := do(t, "GET", "/api/billing/subscription", u.AccessToken, nil)
	require.Equal(t, 200, s2.status)
	require.Equal(t, "pro", str(s2.body, "subscription", "plan"))
	require.Equal(t, "active", str(s2.body, "subscription", "status"))
}

// Isolation: one user's subscription does not leak to another (each has their own).
func TestBillingSubscriptionIsolation(t *testing.T) {
	a := newUser(t)
	b := newUser(t)

	// a assina o pro.
	co := do(t, "POST", "/api/billing/checkout", a.AccessToken, map[string]any{"plan": "pro"})
	require.Equal(t, 200, co.status, "%v", co.body)
	path := strings.TrimPrefix(str(co.body, "checkout_url"), "http://localhost:4000")
	require.Equal(t, 302, do(t, "GET", path, "", nil).status)

	// b continua free.
	s := do(t, "GET", "/api/billing/subscription", b.AccessToken, nil)
	require.Equal(t, 200, s.status)
	require.Equal(t, "free", str(s.body, "subscription", "plan"))
}

// An invalid or free plan does not create a checkout.
func TestBillingInvalidPlan(t *testing.T) {
	u := newUser(t)
	require.Equal(t, 400, do(t, "POST", "/api/billing/checkout", u.AccessToken, map[string]any{"plan": "free"}).status)
	require.Equal(t, 400, do(t, "POST", "/api/billing/checkout", u.AccessToken, map[string]any{"plan": "inexistente"}).status)
}
