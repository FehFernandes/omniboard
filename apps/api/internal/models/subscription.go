package models

import "time"

// Subscription is a user's billing subscription. Each user has at most one
// subscription — that is why user_id is unique.
//
// The state is driven by the payment provider via webhook (the source of
// truth): the app never marks "paid" on its own, it only reacts to the
// verified event from the gateway. The provider ids (customer/subscription) stay
// out of the safe view (ToResponse).
type Subscription struct {
	BaseModel
	UserID string `gorm:"type:uuid;uniqueIndex;not null" json:"user_id"`

	Provider               string `gorm:"type:varchar(30)" json:"provider"`
	Plan                   string `gorm:"type:varchar(30);not null;default:'free'" json:"plan"`
	Status                 string `gorm:"type:varchar(30);not null;default:'inactive'" json:"status"`
	ProviderCustomerID     string `gorm:"type:varchar(255);index" json:"-"`
	ProviderSubscriptionID string `gorm:"type:varchar(255);index" json:"-"`

	CurrentPeriodEnd  *time.Time `json:"current_period_end,omitempty"`
	CancelAtPeriodEnd bool       `gorm:"default:false" json:"cancel_at_period_end"`
}

// SubscriptionResponse is the safe view (without the provider's internal ids).
type SubscriptionResponse struct {
	Plan              string     `json:"plan"`
	Status            string     `json:"status"`
	Provider          string     `json:"provider"`
	CurrentPeriodEnd  *time.Time `json:"current_period_end,omitempty"`
	CancelAtPeriodEnd bool       `json:"cancel_at_period_end"`
}

// ToResponse converts to the safe view.
func (s *Subscription) ToResponse() SubscriptionResponse {
	return SubscriptionResponse{
		Plan: s.Plan, Status: s.Status, Provider: s.Provider,
		CurrentPeriodEnd: s.CurrentPeriodEnd, CancelAtPeriodEnd: s.CancelAtPeriodEnd,
	}
}

// IsActive reports whether the subscription entitles use (paid and current).
func (s *Subscription) IsActive() bool {
	return s.Status == "active" || s.Status == "trialing"
}
