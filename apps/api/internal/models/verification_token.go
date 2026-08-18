package models

import "time"

// Purposes of a single-use verification token.
const (
	PurposeEmailVerify   = "email_verify"
	PurposePasswordReset = "password_reset"
	// PurposeOAuthExchange is the opaque, short-lived code handed to the front
	// end at the end of the OAuth flow. It exists so we do NOT put access/refresh
	// tokens in the redirect URL (where they would end up in the browser history,
	// in the Referer header and in proxy logs). The front end exchanges this code
	// for the token pair via POST on /api/auth/google/exchange.
	PurposeOAuthExchange = "oauth_exchange"
)

// VerificationToken is a single-use token for email verification or password
// reset. We store only the hash (SHA-256); the raw value goes to the user by
// email and is never persisted — if the database leaks, the tokens are not reusable.
type VerificationToken struct {
	BaseModel
	UserID    string     `gorm:"type:uuid;index;not null" json:"-"`
	Purpose   string     `gorm:"type:varchar(30);index;not null" json:"-"`
	TokenHash string     `gorm:"type:varchar(64);uniqueIndex;not null" json:"-"`
	ExpiresAt time.Time  `gorm:"index" json:"-"`
	UsedAt    *time.Time `json:"-"`
}

// TableName defines the table name.
func (VerificationToken) TableName() string { return "verification_tokens" }

// IsUsable reports whether the token is still usable (not consumed, not expired).
func (v *VerificationToken) IsUsable() bool {
	return v.UsedAt == nil && time.Now().Before(v.ExpiresAt)
}
