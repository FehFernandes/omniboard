package config

import (
	"fmt"
	"log"
	"time"

	"github.com/FehFernandes/omniboard/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Database opens the connection to PostgreSQL.
func Database() (*gorm.DB, error) {
	// SSL: in production, require an encrypted connection by default. In dev/test
	// the default is "disable" to make local setup easier. An explicit value in
	// DB_SSLMODE always prevails.
	defaultSSL := "disable"
	if IsProduction() {
		defaultSSL = "require"
	}
	sslmode := getEnv("DB_SSLMODE", defaultSSL)
	if IsProduction() && sslmode == "disable" {
		log.Println("⚠️  DB_SSLMODE=disable in production: database connection WITHOUT encryption")
	}

	dsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=%s TimeZone=America/Sao_Paulo",
		getEnv("DB_HOST", "localhost"),
		getEnv("DB_USER", "postgres"),
		getEnv("DB_PASSWORD", "postgres"),
		getEnv("DB_NAME", "omniboard_dev"),
		getEnv("DB_PORT", "5434"),
		sslmode,
	)

	logLevel := logger.Silent
	if IsDevelopment() {
		logLevel = logger.Info
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger:  logger.Default.LogMode(logLevel),
		NowFunc: func() time.Time { return time.Now().UTC() },
	})
	if err != nil {
		return nil, fmt.Errorf("could not connect to PostgreSQL: %w", err)
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("could not get the DB instance: %w", err)
	}
	// Configurable pool. Defensive default: do not blow past Postgres' max_connections
	// (default 100). With several app instances, tune DB_MAX_OPEN_CONNS per instance.
	maxOpen := envInt("DB_MAX_OPEN_CONNS", 25)
	maxIdle := envInt("DB_MAX_IDLE_CONNS", 10)
	sqlDB.SetMaxOpenConns(maxOpen)
	sqlDB.SetMaxIdleConns(maxIdle)
	sqlDB.SetConnMaxLifetime(time.Hour)
	sqlDB.SetConnMaxIdleTime(10 * time.Minute)

	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("could not verify the connection: %w", err)
	}

	log.Println("✅ Connected to PostgreSQL")
	return db, nil
}

// Migrate runs the automatic migrations.
func Migrate(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&models.User{},
		&models.Session{},
		&models.VerificationToken{},
		&models.AuditLog{},
		&models.TwoFactorRecoveryCode{},
		&models.Subscription{}, // billing/subscription (one per user)
		&models.Item{},         // example resource — swap for your own models
		&models.Board{},        // generated
		&models.Workspace{},    // singleton per user (BoardManager workspace)
		&models.BoardShare{},   // public read-only links to a board
		// gen:models — do not remove: resource generator anchor (tools/gen-resource.mjs)
	); err != nil {
		return err
	}
	return createCompositeIndexes(db)
}

// createCompositeIndexes creates the indexes and the full-text search column of
// the example resource. Adjust/duplicate for your own entities.
func createCompositeIndexes(db *gorm.DB) error {
	stmts := []string{
		// Google-only login: GORM's AutoMigrate creates and alters columns, but it
		// NEVER loosens existing constraints. Databases created before the migration
		// to Google-only authentication still have `password NOT NULL`; since the
		// model no longer has that field, every user INSERT would fail. The DO/IF
		// EXISTS keeps this idempotent and safe on new databases, where the column
		// does not even exist. Equivalent to versioned migration 000007.
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns
			           WHERE table_name = 'users' AND column_name = 'password') THEN
				ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
			END IF;
		END $$`,
		// auth_provider existed to distinguish local accounts from social ones. With a
		// single provider, the column is constant and tells us nothing.
		`ALTER TABLE users DROP COLUMN IF EXISTS auth_provider`,
		// Filter by status within the owner.
		`CREATE INDEX IF NOT EXISTS idx_item_user_status ON items (user_id, status)`,
		// "Feed" index for cursor pagination: (user_id, created_at DESC, id DESC).
		// Covers the stable ordering used by the keyset — deep pages at constant cost.
		`CREATE INDEX IF NOT EXISTS idx_item_user_feed ON items (user_id, created_at DESC, id DESC)`,
		// Full-text search: generated tsvector column (title + description) + GIN index.
		// Replaces the ILIKE '%...%' (which does a seq scan) with an indexed search.
		`ALTER TABLE items ADD COLUMN IF NOT EXISTS search_vector tsvector
			GENERATED ALWAYS AS (
				to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))
			) STORED`,
		`CREATE INDEX IF NOT EXISTS idx_item_search ON items USING GIN (search_vector)`,
		// Audit: "feed" index by owner for the keyset (actor_user_id, created_at DESC, id DESC).
		`CREATE INDEX IF NOT EXISTS idx_audit_actor_feed ON audit_logs (actor_user_id, created_at DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_board_user_status ON boards (user_id, status)`,
		`CREATE INDEX IF NOT EXISTS idx_board_user_feed ON boards (user_id, created_at DESC, id DESC)`,
		`ALTER TABLE boards ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))) STORED`,
		`CREATE INDEX IF NOT EXISTS idx_board_search ON boards USING GIN (search_vector)`,
		// gen:indexes — do not remove: resource generator anchor (tools/gen-resource.mjs)
	}
	for _, s := range stmts {
		if err := db.Exec(s).Error; err != nil {
			return err
		}
	}
	return nil
}
