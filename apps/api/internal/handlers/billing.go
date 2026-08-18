package handlers

import (
	"errors"
	"log/slog"
	"time"

	"github.com/FehFernandes/omniboard/internal/middleware"
	"github.com/FehFernandes/omniboard/internal/models"
	"github.com/FehFernandes/omniboard/internal/payments"
	"github.com/FehFernandes/omniboard/internal/utils"
	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

// BillingHandler exposes the billing/subscription endpoints. It depends only on
// the payments.Provider interface — Stripe in production, Fake in dev/tests. The
// subscription is scoped by the owner user (user_id from the token).
type BillingHandler struct {
	db       *gorm.DB
	provider payments.Provider
}

// NewBillingHandler creates the billing handler.
func NewBillingHandler(db *gorm.DB, provider payments.Provider) *BillingHandler {
	return &BillingHandler{db: db, provider: provider}
}

// ListPlans returns the catalog of plans (public pricing information).
// GET /api/billing/plans
func (h *BillingHandler) ListPlans(c *fiber.Ctx) error {
	return utils.Success(c, fiber.StatusOK, fiber.Map{
		"plans":    payments.Plans(),
		"provider": h.provider.Name(),
	})
}

// GetSubscription returns the user's current subscription (or the "free" default).
// GET /api/billing/subscription
func (h *BillingHandler) GetSubscription(c *fiber.Ctx) error {
	sub, err := h.currentSubscription(middleware.UserID(c))
	if err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not load the subscription")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"subscription": sub.ToResponse()})
}

// CreateCheckout starts the checkout of a paid plan and returns the payment URL.
// POST /api/billing/checkout  {"plan": "pro"}
func (h *BillingHandler) CreateCheckout(c *fiber.Ctx) error {
	var in struct {
		Plan string `json:"plan"`
	}
	if err := c.BodyParser(&in); err != nil {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid request body")
	}
	plan, ok := payments.PlanByKey(in.Plan)
	if !ok || plan.Free {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid plan for checkout")
	}
	if h.provider.Name() == "stripe" && plan.PriceID == "" {
		return utils.Error(c, fiber.StatusServiceUnavailable, "Plan has no price configured in the provider")
	}

	userID := middleware.UserID(c)
	sub, _ := h.currentSubscription(userID)

	res, err := h.provider.CreateCheckout(c.Context(), payments.CheckoutParams{
		CustomerRef:        userID,
		Email:              middleware.Email(c),
		Plan:               plan,
		ExistingCustomerID: sub.ProviderCustomerID,
		SuccessURL:         appURL() + "/billing/success",
		CancelURL:          appURL() + "/billing/cancel",
	})
	if err != nil {
		slog.Error("billing: could not create the checkout", "user", userID, "err", err)
		return utils.Error(c, fiber.StatusBadGateway, "Could not start the checkout")
	}
	recordAudit(h.db, c, "billing.checkout", "user", userID, map[string]any{"plan": plan.Key})
	return utils.Success(c, fiber.StatusOK, fiber.Map{"checkout_url": res.URL})
}

// CreatePortal opens the subscription management portal (change card, cancel).
// POST /api/billing/portal
func (h *BillingHandler) CreatePortal(c *fiber.Ctx) error {
	userID := middleware.UserID(c)
	sub, err := h.currentSubscription(userID)
	if err != nil || sub.ProviderCustomerID == "" {
		return utils.Error(c, fiber.StatusBadRequest, "No subscription to manage")
	}
	u, err := h.provider.CreatePortal(c.Context(), sub.ProviderCustomerID, appURL()+"/billing")
	if err != nil {
		slog.Error("billing: could not open the portal", "user", userID, "err", err)
		return utils.Error(c, fiber.StatusBadGateway, "Could not open the billing portal")
	}
	return utils.Success(c, fiber.StatusOK, fiber.Map{"portal_url": u})
}

// Webhook receives events from the provider (public route, authenticated by the
// provider's own signature — NOT by JWT).
// POST /api/billing/webhook
func (h *BillingHandler) Webhook(c *fiber.Ctx) error {
	evt, err := h.provider.ParseWebhook(c.Body(), c.Get("Stripe-Signature"))
	if err != nil {
		slog.Warn("billing: webhook rejeitado", "err", err)
		return utils.Error(c, fiber.StatusBadRequest, "Invalid webhook")
	}
	if err := h.applyEvent(evt); err != nil {
		slog.Error("billing: could not apply the event", "err", err)
		return utils.Error(c, fiber.StatusInternalServerError, "Could not process the event")
	}
	return c.JSON(fiber.Map{"received": true})
}

// DevComplete simulates the completion of the FakeProvider checkout (dev/tests
// ONLY): it activates the subscription as if the provider webhook had arrived and
// redirects to the success page. Unavailable when the provider is real (Stripe).
// GET /api/billing/dev/complete?ref=<userID>&plan=<key>
func (h *BillingHandler) DevComplete(c *fiber.Ctx) error {
	if h.provider.Name() != "fake" {
		return utils.Error(c, fiber.StatusNotFound, "Unavailable")
	}
	ref := c.Query("ref")
	planKey := c.Query("plan")
	if ref == "" || planKey == "" {
		return utils.Error(c, fiber.StatusBadRequest, "ref and plan are required")
	}
	if _, ok := payments.PlanByKey(planKey); !ok {
		return utils.Error(c, fiber.StatusBadRequest, "Invalid plan")
	}
	err := h.applyEvent(payments.Event{
		Type:                   payments.EventSubscriptionActive,
		CustomerRef:            ref,
		PlanKey:                planKey,
		ProviderCustomerID:     "fake_cus_" + ref,
		ProviderSubscriptionID: "fake_sub_" + ref,
		Status:                 "active",
		CurrentPeriodEnd:       time.Now().AddDate(0, 1, 0).UTC(),
	})
	if err != nil {
		return utils.Error(c, fiber.StatusInternalServerError, "Could not activate the subscription (fake)")
	}
	return c.Redirect(appURL()+"/billing/success", fiber.StatusFound)
}

// currentSubscription returns the user's subscription or a default "free" one
// (without persisting it) when there is no record yet.
func (h *BillingHandler) currentSubscription(userID string) (models.Subscription, error) {
	var sub models.Subscription
	err := h.db.Where("user_id = ?", userID).First(&sub).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.Subscription{UserID: userID, Plan: "free", Status: "inactive"}, nil
	}
	return sub, err
}

// applyEvent is the only point that changes the billing state — called both by
// the webhook (Stripe) and by the dev route (Fake). It does an idempotent upsert
// of the Subscription scoped by the user.
func (h *BillingHandler) applyEvent(evt payments.Event) error {
	if evt.Type == payments.EventIgnored || evt.CustomerRef == "" {
		return nil
	}

	planKey := evt.PlanKey
	status := "inactive"
	switch evt.Type {
	case payments.EventSubscriptionActive:
		status = "active"
	case payments.EventSubscriptionCanceled:
		status = "canceled"
		planKey = "free"
	}
	if planKey == "" {
		planKey = "free"
	}

	var periodEnd *time.Time
	if !evt.CurrentPeriodEnd.IsZero() {
		t := evt.CurrentPeriodEnd
		periodEnd = &t
	}

	// Upsert by user_id (idempotent — webhooks may repeat).
	var existing models.Subscription
	err := h.db.Where("user_id = ?", evt.CustomerRef).First(&existing).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		sub := models.Subscription{
			UserID:                 evt.CustomerRef,
			Provider:               h.provider.Name(),
			Plan:                   planKey,
			Status:                 status,
			ProviderCustomerID:     evt.ProviderCustomerID,
			ProviderSubscriptionID: evt.ProviderSubscriptionID,
			CurrentPeriodEnd:       periodEnd,
			CancelAtPeriodEnd:      evt.CancelAtPeriodEnd,
		}
		return h.db.Create(&sub).Error
	case err != nil:
		return err
	default:
		updates := map[string]any{
			"provider":             h.provider.Name(),
			"plan":                 planKey,
			"status":               status,
			"current_period_end":   periodEnd,
			"cancel_at_period_end": evt.CancelAtPeriodEnd,
		}
		if evt.ProviderCustomerID != "" {
			updates["provider_customer_id"] = evt.ProviderCustomerID
		}
		if evt.ProviderSubscriptionID != "" {
			updates["provider_subscription_id"] = evt.ProviderSubscriptionID
		}
		return h.db.Model(&existing).Updates(updates).Error
	}
}
