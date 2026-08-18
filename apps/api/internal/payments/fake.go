package payments

import (
	"context"
	"errors"
	"fmt"
	"net/url"
)

// FakeProvider simulates a gateway for development and tests, WITHOUT requiring
// any key. The checkout returns a URL to an internal endpoint of the API itself
// (GET /api/billing/dev/complete) that activates the subscription right away —
// so you can exercise the full flow (checkout → activation → active
// subscription) locally, just by opening the URL in the browser or with a curl.
//
// It is the default provider when STRIPE_SECRET_KEY is not defined.
type FakeProvider struct{}

// Name identifies the provider.
func (FakeProvider) Name() string { return "fake" }

// CreateCheckout returns a link to the API's own (dev) completion route.
func (FakeProvider) CreateCheckout(_ context.Context, p CheckoutParams) (CheckoutResult, error) {
	u := fmt.Sprintf(
		"%s/api/billing/dev/complete?ref=%s&plan=%s",
		apiBaseURL(),
		url.QueryEscape(p.CustomerRef),
		url.QueryEscape(p.Plan.Key),
	)
	return CheckoutResult{URL: u}, nil
}

// CreatePortal returns a fictitious portal URL (for dev only).
func (FakeProvider) CreatePortal(_ context.Context, _, returnURL string) (string, error) {
	if returnURL == "" {
		returnURL = appBaseURL()
	}
	return returnURL + "?portal=fake", nil
}

// ParseWebhook does not apply to the fake provider — activation in dev happens
// through the /api/billing/dev/complete route, which builds the Event internally.
func (FakeProvider) ParseWebhook(_ []byte, _ string) (Event, error) {
	return Event{}, errors.New("the fake provider receives no webhooks; use /api/billing/dev/complete in dev")
}
