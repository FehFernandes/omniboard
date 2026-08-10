package payments

import "os"

// Plan describes a sellable subscription plan. Adjust the catalog in Plans()
// to your product. The PriceIDs come from the environment so we do not hardcode
// provider ids (Stripe price_...) in the code.
type Plan struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	PriceID  string `json:"-"`        // price id at the provider (not exposed in the API)
	Amount   int    `json:"amount"`   // in cents, for display only
	Currency string `json:"currency"` // e.g.: "brl"
	Interval string `json:"interval"` // "month" | "year"
	Free     bool   `json:"free"`     // free plan does not go through checkout
}

// Plans returns the catalog of offered plans. Edit freely.
func Plans() []Plan {
	return []Plan{
		{Key: "free", Name: "Free", Amount: 0, Currency: "brl", Interval: "month", Free: true},
		{Key: "pro", Name: "Pro", PriceID: os.Getenv("STRIPE_PRICE_PRO"), Amount: 1900, Currency: "brl", Interval: "month"},
	}
}

// PlanByKey looks up a plan by key. ok=false when it does not exist.
func PlanByKey(key string) (Plan, bool) {
	for _, p := range Plans() {
		if p.Key == key {
			return p, true
		}
	}
	return Plan{}, false
}
