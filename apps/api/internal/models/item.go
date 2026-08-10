package models

// Item is the EXAMPLE resource of the starter. It demonstrates the pattern of an
// entity that belongs to a user (ownership by user_id): each account sees and
// manipulates only its own items.
//
// Use it as a template: copy/rename it for your real entities (e.g.: Note,
// Page, Task, Document...) and delete Item when you no longer need it.
//
// ⚠️ When copying: the composite indexes and the full-text `search_vector` column
// are NOT created by AutoMigrate — they live in config.createCompositeIndexes
// (internal/config/database.go). Duplicate/adjust those CREATE INDEX for the
// new entity if you want performant search (?search) and cursor pagination.
type Item struct {
	BaseModel

	// Owner of the record. Every access is filtered by this field (from the JWT).
	UserID string `gorm:"type:uuid;index;not null" json:"user_id"`

	Title       string `gorm:"type:varchar(200);not null" json:"title"`
	Description string `gorm:"type:text" json:"description"`
	Status      string `gorm:"type:varchar(20);index;default:'active'" json:"status"`
}

// ValidItemStatus validates the item status. Adjust the values to your domain.
func ValidItemStatus(s string) bool {
	switch s {
	case "active", "archived", "done":
		return true
	}
	return false
}
