package models

import "time"

// User is an individual account. Each user is the owner of their own data
// (personal app model, Notion style). The email is globally unique.
//
// Every account is born from a Google login — there is no password signup in
// this application. Hence the absence of fields like password, failed_attempts
// or locked_until: with no password to guess, there is nothing to lock. Lockout
// by attempts is Google's own responsibility.
type User struct {
	BaseModel
	Name  string `gorm:"type:varchar(150);not null" json:"name"`
	Email string `gorm:"type:varchar(255);not null;uniqueIndex" json:"email"`

	Avatar   string `gorm:"type:varchar(500)" json:"avatar"`
	IsActive bool   `gorm:"default:true" json:"is_active"`

	// GoogleID is the `sub` claim of Google's ID token: the stable identifier of
	// the user at that provider. We use the `sub`, and not the email, because the
	// email can change while the `sub` never changes.
	//
	// In practice every account created by this code has GoogleID filled in. The
	// field is a pointer (allows NULL) for two reasons: the Postgres unique
	// index ignores NULLs — which avoids collision — and databases that already
	// existed before the migration to Google-only login may have rows without
	// `sub`. Those rows simply cannot authenticate anymore.
	GoogleID *string `gorm:"type:varchar(64);uniqueIndex" json:"-"`

	// EmailVerifiedAt is filled in at account creation: Google only hands us
	// profiles with a verified email (see the gate in resolveGoogleUser).
	EmailVerifiedAt *time.Time `json:"email_verified_at"`

	// Optional 2FA (TOTP), as a second step ON TOP OF the Google login.
	// TOTPSecret is already filled in at enroll, but 2FA only takes effect when
	// TOTPEnabledAt != nil, after a code is confirmed. Known tradeoff: the
	// secret is stored in cleartext; if your threat model requires it,
	// encrypt it at rest.
	TOTPSecret    string     `gorm:"type:varchar(64)" json:"-"`
	TOTPEnabledAt *time.Time `json:"-"`

	// Sessions (refresh tokens) live in the `sessions` table — multi-device
	// and individually revocable. See models/session.go.
	LastLoginAt *time.Time `json:"last_login_at"`
	LastLoginIP string     `gorm:"type:varchar(45)" json:"-"`
}

// TableName defines the table name.
func (User) TableName() string { return "users" }

// TwoFactorEnabled reports whether 2FA (TOTP) is active for the user.
func (u *User) TwoFactorEnabled() bool {
	return u.TOTPEnabledAt != nil
}

// UserResponse is the safe view of a user (without 2FA secrets).
type UserResponse struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Email       string     `json:"email"`
	Avatar      string     `json:"avatar"`
	IsActive    bool       `json:"is_active"`
	TwoFactor   bool       `json:"two_factor_enabled"`
	LastLoginAt *time.Time `json:"last_login_at"`
}

// ToResponse converts to the safe view.
func (u *User) ToResponse() UserResponse {
	return UserResponse{
		ID: u.ID, Name: u.Name, Email: u.Email,
		Avatar: u.Avatar, IsActive: u.IsActive,
		TwoFactor:   u.TOTPEnabledAt != nil,
		LastLoginAt: u.LastLoginAt,
	}
}
