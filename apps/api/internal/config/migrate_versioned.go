package config

import (
	"database/sql"
	"errors"
	"fmt"
	"os"

	"github.com/FehFernandes/omniboard/internal/migrations"
	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/lib/pq" // registers the "postgres" driver (used only by the migrations)
)

// UseVersionedMigrations reports whether the app should use versioned migrations
// (golang-migrate) instead of AutoMigrate. Enable it with DB_MIGRATE=versioned.
// Recommended in production; AutoMigrate remains the convenient default for dev.
func UseVersionedMigrations() bool {
	return os.Getenv("DB_MIGRATE") == "versioned"
}

// migrationDSN builds the DSN (lib/pq format) used exclusively by the migrations.
// We use lib/pq here (and not GORM's pgx) because the golang-migrate driver
// runs multi-statement files in a single Exec — something lib/pq supports.
func migrationDSN() string {
	sslmode := getEnv("DB_SSLMODE", "disable")
	if IsProduction() && os.Getenv("DB_SSLMODE") == "" {
		sslmode = "require"
	}
	return fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s port=%s sslmode=%s",
		getEnv("DB_HOST", "localhost"),
		getEnv("DB_USER", "postgres"),
		getEnv("DB_PASSWORD", "postgres"),
		getEnv("DB_NAME", "omniboard_dev"),
		getEnv("DB_PORT", "5434"),
		sslmode,
	)
}

// newMigrator opens a dedicated connection and builds the *migrate.Migrate from
// the embedded migrations. The caller must close the returned *sql.DB.
func newMigrator() (*migrate.Migrate, *sql.DB, error) {
	db, err := sql.Open("postgres", migrationDSN())
	if err != nil {
		return nil, nil, fmt.Errorf("migrations: opening the connection: %w", err)
	}
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		db.Close()
		return nil, nil, fmt.Errorf("migrations: postgres driver: %w", err)
	}
	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		db.Close()
		return nil, nil, fmt.Errorf("migrations: embedded source: %w", err)
	}
	m, err := migrate.NewWithInstance("iofs", src, "postgres", driver)
	if err != nil {
		db.Close()
		return nil, nil, fmt.Errorf("migrations: instantiating: %w", err)
	}
	return m, db, nil
}

// RunMigrations applies all pending migrations (equivalent to `migrate up`).
func RunMigrations() error {
	m, db, err := newMigrator()
	if err != nil {
		return err
	}
	defer db.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}

// MigrateDown reverts `steps` migrations (use 1 to revert the last one).
func MigrateDown(steps int) error {
	m, db, err := newMigrator()
	if err != nil {
		return err
	}
	defer db.Close()
	if err := m.Steps(-steps); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}
	return nil
}

// MigrateVersion returns the current version and whether the schema is "dirty".
func MigrateVersion() (version uint, dirty bool, err error) {
	m, db, err := newMigrator()
	if err != nil {
		return 0, false, err
	}
	defer db.Close()
	version, dirty, err = m.Version()
	if errors.Is(err, migrate.ErrNilVersion) {
		return 0, false, nil
	}
	return version, dirty, err
}

// MigrateForce pins the version without migrating — unblocks a "dirty" schema.
func MigrateForce(version int) error {
	m, db, err := newMigrator()
	if err != nil {
		return err
	}
	defer db.Close()
	return m.Force(version)
}
