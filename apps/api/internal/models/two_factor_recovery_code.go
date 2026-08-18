package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TwoFactorRecoveryCode is a single-use 2FA recovery code — used when the user
// loses access to the authenticator app. We store only the hash (SHA-256); the
// raw value is shown a single time when 2FA is enabled.
type TwoFactorRecoveryCode struct {
	ID        string     `gorm:"type:uuid;primaryKey" json:"-"`
	CreatedAt time.Time  `json:"-"`
	UserID    string     `gorm:"type:uuid;index;not null" json:"-"`
	CodeHash  string     `gorm:"type:varchar(64);index;not null" json:"-"`
	UsedAt    *time.Time `json:"-"`
}

// TableName defines the table name.
func (TwoFactorRecoveryCode) TableName() string { return "two_factor_recovery_codes" }

// BeforeCreate generates a UUID v4 before insert, if there isn't one yet.
func (t *TwoFactorRecoveryCode) BeforeCreate(_ *gorm.DB) error {
	if t.ID == "" {
		t.ID = uuid.NewString()
	}
	return nil
}
