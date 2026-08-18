package models

import "gorm.io/datatypes"

// Workspace — singleton per user: holds the complete BoardManager snapshot
// (all boards/tabs + active board) as JSON. One record per user.
type Workspace struct {
	BaseModel

	// Owner. Unique per user (uniqueIndex): each user has 1 workspace.
	UserID string `gorm:"type:uuid;uniqueIndex;not null" json:"user_id"`

	// Data — workspace snapshot (openboard-workspace: documents[], activeId).
	Data datatypes.JSON `gorm:"type:jsonb" json:"data"`

	// Version — write counter, for optimistic concurrency.
	//
	// On PUT the client returns the version it read; if stale, the API refuses
	// with 409 instead of overwriting what another tab wrote. Grows on each save.
	Version int64 `gorm:"not null;default:1" json:"version"`
}

// TableName pins the table name.
func (Workspace) TableName() string { return "workspaces" }
