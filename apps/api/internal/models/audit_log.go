package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AuditLog is an APPEND-ONLY record of sensitive account events (login, password/
// email change, 2FA, etc.).
//
// By design it is immutable: it has no updated_at and no soft delete — we only
// insert. It is NOT purged by the maintenance job (unlike sessions/tokens): the
// history is its value. If you need to retain it for a limited time, apply your
// own retention policy.
//
// ActorUserID is a pointer (nullable): some events happen with no authenticated
// actor in the context (e.g.: password reset via public token).
type AuditLog struct {
	ID          string    `gorm:"type:uuid;primaryKey" json:"id"`
	CreatedAt   time.Time `gorm:"index" json:"created_at"`
	ActorUserID *string   `gorm:"type:uuid;index" json:"actor_user_id,omitempty"`
	ActorEmail  string    `gorm:"type:varchar(255)" json:"actor_email,omitempty"`
	Action      string    `gorm:"type:varchar(60);index;not null" json:"action"`
	TargetType  string    `gorm:"type:varchar(60)" json:"target_type,omitempty"`
	TargetID    string    `gorm:"type:varchar(64)" json:"target_id,omitempty"`
	IP          string    `gorm:"type:varchar(45)" json:"ip,omitempty"`
	// Metadata is free-form JSON (jsonb) with details of the event. Always valid:
	// the audit.Meta helper guarantees "{}" when empty.
	Metadata string `gorm:"type:jsonb;default:'{}'" json:"metadata,omitempty"`
}

// TableName defines the table name.
func (AuditLog) TableName() string { return "audit_logs" }

// BeforeCreate generates a UUID v4 before insert, if there isn't one yet.
func (a *AuditLog) BeforeCreate(_ *gorm.DB) error {
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	return nil
}
