// Package payments abstracts the billing provider (subscriptions). The
// implementation is chosen by environment — exactly like the mailer:
//
//   - STRIPE_SECRET_KEY defined → StripeProvider (real Stripe, via REST API)
//   - otherwise                 → FakeProvider (dev/tests, WITHOUT any key)
//
// The rest of the application depends only on the Provider interface, so
// swapping or adding a gateway (Mercado Pago, Paddle, Asaas...) is just
// implementing the interface and adjusting New(). The source of truth for the
// subscription state is ALWAYS the provider: the app never marks "paid" on its
// own, it only reacts to a verified event (webhook).
package payments

import (
	"context"
	"os"
	"strings"
	"time"
)

// EventType normalizes the billing events the application knows how to handle,
// regardless of each provider's specific vocabulary.
type EventType string

const (
	// EventSubscriptionActive: subscription paid and current (activate access).
	EventSubscriptionActive EventType = "subscription_active"
	// EventSubscriptionCanceled: subscription canceled/expired (revoke access).
	EventSubscriptionCanceled EventType = "subscription_canceled"
	// EventIgnored: event received but irrelevant to our domain.
	EventIgnored EventType = "ignored"
)

// Event is the normalized form of a webhook, already provider-independent.
type Event struct {
	Type EventType
	// CustomerRef is our internal reference (user_id in the single-user app),
	// propagated in the checkout metadata and returned in the webhook.
	CustomerRef            string
	PlanKey                string
	ProviderCustomerID     string
	ProviderSubscriptionID string
	Status                 string
	CurrentPeriodEnd       time.Time
	CancelAtPeriodEnd      bool
}

// CheckoutParams goes into CreateCheckout.
type CheckoutParams struct {
	CustomerRef        string // user_id
	Email              string
	Plan               Plan
	ExistingCustomerID string // reuses the provider's customer, if it already exists
	SuccessURL         string
	CancelURL          string
}

// CheckoutResult is the return of CreateCheckout: the URL to redirect the client.
type CheckoutResult struct {
	URL string
}

// Provider is the contract of a subscription gateway.
type Provider interface {
	// Name identifies the provider ("stripe", "fake").
	Name() string
	// CreateCheckout starts a subscription and returns the payment URL.
	CreateCheckout(ctx context.Context, p CheckoutParams) (CheckoutResult, error)
	// CreatePortal returns the URL of the management portal (change card, cancel).
	CreatePortal(ctx context.Context, customerID, returnURL string) (string, error)
	// ParseWebhook verifies the signature and returns the normalized event.
	ParseWebhook(payload []byte, signature string) (Event, error)
}

// New returns the implementation suited to the environment.
func New() Provider {
	if key := os.Getenv("STRIPE_SECRET_KEY"); key != "" {
		return newStripeProvider(key, os.Getenv("STRIPE_WEBHOOK_SECRET"))
	}
	return FakeProvider{}
}

// apiBaseURL is the public URL of this API (used by FakeProvider to build the
// checkout completion link in dev). Configurable via API_URL.
func apiBaseURL() string {
	if v := os.Getenv("API_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://localhost:4000"
}

// appBaseURL is the frontend's base URL. Configurable via APP_URL.
func appBaseURL() string {
	if v := os.Getenv("APP_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://localhost:5173"
}
