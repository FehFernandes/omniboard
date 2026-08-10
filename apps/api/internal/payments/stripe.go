package payments

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// stripeProvider talks to the Stripe REST API using only the stdlib
// (net/http). We deliberately do NOT use the stripe-go SDK, to keep the starter
// with zero new dependencies — the cost is a handful of simple HTTP calls.
type stripeProvider struct {
	secretKey     string
	webhookSecret string
	http          *http.Client
}

func newStripeProvider(secret, webhookSecret string) *stripeProvider {
	return &stripeProvider{
		secretKey:     secret,
		webhookSecret: webhookSecret,
		http:          &http.Client{Timeout: 20 * time.Second},
	}
}

// Name identifies the provider.
func (s *stripeProvider) Name() string { return "stripe" }

// post makes an authenticated form-encoded POST to Stripe's API and returns JSON.
func (s *stripeProvider) post(ctx context.Context, path string, form url.Values) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.stripe.com/v1/"+path, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	// HTTP Basic authentication: user = secret key, empty password.
	req.SetBasicAuth(s.secretKey, "")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("stripe: invalid response (%d): %w", resp.StatusCode, err)
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("stripe: HTTP error %d: %s", resp.StatusCode, string(body))
	}
	return out, nil
}

// CreateCheckout creates a Checkout Session in subscription mode.
func (s *stripeProvider) CreateCheckout(ctx context.Context, p CheckoutParams) (CheckoutResult, error) {
	if p.Plan.PriceID == "" {
		return CheckoutResult{}, errors.New("stripe: plan has no PriceID configured")
	}
	form := url.Values{}
	form.Set("mode", "subscription")
	form.Set("line_items[0][price]", p.Plan.PriceID)
	form.Set("line_items[0][quantity]", "1")
	form.Set("success_url", p.SuccessURL)
	form.Set("cancel_url", p.CancelURL)
	form.Set("client_reference_id", p.CustomerRef)
	if p.ExistingCustomerID != "" {
		form.Set("customer", p.ExistingCustomerID)
	} else if p.Email != "" {
		form.Set("customer_email", p.Email)
	}
	// Propagates our internal reference + the plan in the metadata, both on the
	// session and the created subscription — it is how we find the user in the webhook.
	form.Set("metadata[ref]", p.CustomerRef)
	form.Set("metadata[plan]", p.Plan.Key)
	form.Set("subscription_data[metadata][ref]", p.CustomerRef)
	form.Set("subscription_data[metadata][plan]", p.Plan.Key)

	out, err := s.post(ctx, "checkout/sessions", form)
	if err != nil {
		return CheckoutResult{}, err
	}
	u, _ := out["url"].(string)
	if u == "" {
		return CheckoutResult{}, errors.New("stripe: checkout session sem url")
	}
	return CheckoutResult{URL: u}, nil
}

// CreatePortal opens a Stripe Billing Portal session.
func (s *stripeProvider) CreatePortal(ctx context.Context, customerID, returnURL string) (string, error) {
	if customerID == "" {
		return "", errors.New("stripe: cliente sem customer id")
	}
	form := url.Values{}
	form.Set("customer", customerID)
	form.Set("return_url", returnURL)
	out, err := s.post(ctx, "billing_portal/sessions", form)
	if err != nil {
		return "", err
	}
	u, _ := out["url"].(string)
	if u == "" {
		return "", errors.New("stripe: portal session sem url")
	}
	return u, nil
}

// ParseWebhook validates the signature (HMAC-SHA256) and normalizes the event.
func (s *stripeProvider) ParseWebhook(payload []byte, sigHeader string) (Event, error) {
	if s.webhookSecret == "" {
		return Event{}, errors.New("stripe: STRIPE_WEBHOOK_SECRET is not configured")
	}
	if err := verifyStripeSignature(payload, sigHeader, s.webhookSecret); err != nil {
		return Event{}, err
	}

	var envelope struct {
		Type string `json:"type"`
		Data struct {
			Object json.RawMessage `json:"object"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return Event{}, err
	}

	switch envelope.Type {
	case "checkout.session.completed":
		var o struct {
			Customer          string            `json:"customer"`
			Subscription      string            `json:"subscription"`
			ClientReferenceID string            `json:"client_reference_id"`
			Metadata          map[string]string `json:"metadata"`
		}
		_ = json.Unmarshal(envelope.Data.Object, &o)
		ref := o.Metadata["ref"]
		if ref == "" {
			ref = o.ClientReferenceID
		}
		return Event{
			Type:                   EventSubscriptionActive,
			CustomerRef:            ref,
			PlanKey:                o.Metadata["plan"],
			ProviderCustomerID:     o.Customer,
			ProviderSubscriptionID: o.Subscription,
			Status:                 "active",
		}, nil

	case "customer.subscription.created", "customer.subscription.updated":
		e := parseStripeSubscription(envelope.Data.Object)
		e.Type = EventSubscriptionActive
		if isCanceledStatus(e.Status) {
			e.Type = EventSubscriptionCanceled
		}
		return e, nil

	case "customer.subscription.deleted":
		e := parseStripeSubscription(envelope.Data.Object)
		e.Type = EventSubscriptionCanceled
		return e, nil

	default:
		return Event{Type: EventIgnored}, nil
	}
}

func isCanceledStatus(status string) bool {
	switch status {
	case "canceled", "unpaid", "incomplete_expired":
		return true
	}
	return false
}

// parseStripeSubscription extracts the fields we care about from Stripe's
// subscription object.
func parseStripeSubscription(raw json.RawMessage) Event {
	var o struct {
		ID                string            `json:"id"`
		Customer          string            `json:"customer"`
		Status            string            `json:"status"`
		CancelAtPeriodEnd bool              `json:"cancel_at_period_end"`
		CurrentPeriodEnd  int64             `json:"current_period_end"`
		Metadata          map[string]string `json:"metadata"`
	}
	_ = json.Unmarshal(raw, &o)
	e := Event{
		CustomerRef:            o.Metadata["ref"],
		PlanKey:                o.Metadata["plan"],
		ProviderCustomerID:     o.Customer,
		ProviderSubscriptionID: o.ID,
		Status:                 o.Status,
		CancelAtPeriodEnd:      o.CancelAtPeriodEnd,
	}
	if o.CurrentPeriodEnd > 0 {
		e.CurrentPeriodEnd = time.Unix(o.CurrentPeriodEnd, 0).UTC()
	}
	return e
}

// webhookTolerance is the maximum window (in seconds) between the timestamp
// signed by Stripe and the current time. Events outside it are rejected
// (anti-replay). 300s (5 min) is the same default as Stripe's official library.
const webhookTolerance int64 = 300

// verifyStripeSignature validates the Stripe-Signature header ("t=...,v1=...").
// Reimplements the official verification with stdlib (HMAC-SHA256 of "t.payload").
func verifyStripeSignature(payload []byte, sigHeader, secret string) error {
	var timestamp string
	var sigs []string
	for _, part := range strings.Split(sigHeader, ",") {
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch strings.TrimSpace(kv[0]) {
		case "t":
			timestamp = strings.TrimSpace(kv[1])
		case "v1":
			sigs = append(sigs, strings.TrimSpace(kv[1]))
		}
	}
	if timestamp == "" || len(sigs) == 0 {
		return errors.New("stripe: webhook signature missing or malformed")
	}

	// Timestamp tolerance (protection against replay). Rejects events whose
	// timestamp is outside the window — mirrors Stripe's official lib (default of
	// 5 min). Without this, a captured payload+signature could be resent
	// indefinitely.
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return errors.New("stripe: invalid webhook timestamp")
	}
	if diff := time.Now().Unix() - ts; diff > webhookTolerance || diff < -webhookTolerance {
		return errors.New("stripe: webhook timestamp outside the tolerance (possible replay)")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "." + string(payload)))
	expected := hex.EncodeToString(mac.Sum(nil))

	for _, sig := range sigs {
		if hmac.Equal([]byte(expected), []byte(sig)) {
			return nil
		}
	}
	return errors.New("stripe: invalid webhook signature")
}
