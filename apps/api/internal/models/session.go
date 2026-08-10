package models

import "time"

// Session represents an active refresh token — typically a device/login.
//
// It replaces the old single user.refresh_token field: now a user can have
// several simultaneous sessions (multi-device), each revocable individually
// (logout) or in bulk (logout-all / password reset).
//
// The session ID is the same "sid" carried in the JWT — so logout knows which
// session to revoke without needing the refresh token at hand.
type Session struct {
	BaseModel
	UserID string `gorm:"type:uuid;index;not null" json:"user_id"`

	// We store only the SHA-256 (hex) of the refresh token, never the raw value.
	RefreshHash string `gorm:"type:varchar(64);uniqueIndex;not null" json:"-"`

	UserAgent string     `gorm:"type:varchar(400)" json:"user_agent"`
	IP        string     `gorm:"type:varchar(45)" json:"ip"`
	ExpiresAt time.Time  `gorm:"index" json:"expires_at"`
	RevokedAt *time.Time `json:"revoked_at"`
}

// TableName defines the table name.
func (Session) TableName() string { return "sessions" }

// IsActive reports whether the session still holds (not revoked, not expired).
func (s *Session) IsActive() bool {
	return s.RevokedAt == nil && time.Now().Before(s.ExpiresAt)
}
