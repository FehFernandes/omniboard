package main

import (
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/FehFernandes/omniboard/internal/config"
	"github.com/FehFernandes/omniboard/internal/jobs"
	"github.com/FehFernandes/omniboard/internal/logging"
	"github.com/FehFernandes/omniboard/internal/server"
	"github.com/FehFernandes/omniboard/internal/storage"
	"github.com/joho/godotenv"
)

func main() {
	logging.Setup() // logger estruturado (slog) global

	if err := godotenv.Load(); err != nil {
		slog.Warn(".env not found, using the system environment")
	}

	jwtCfg := config.LoadJWTConfig()
	// Google login is the only authentication path: if the credentials are not in
	// the environment, this terminates the process right here (fail fast).
	googleCfg := config.LoadGoogleOAuth()

	db, err := config.Database()
	if err != nil {
		slog.Error("could not connect to the database", "err", err)
		os.Exit(1)
	}

	// Migrations: versioned (golang-migrate) when DB_MIGRATE=versioned; otherwise
	// AutoMigrate (convenient in dev). See internal/config.
	if config.UseVersionedMigrations() {
		if err := config.RunMigrations(); err != nil {
			slog.Error("versioned migrations failed", "err", err)
			os.Exit(1)
		}
	} else if err := config.Migrate(db); err != nil {
		slog.Error("migrations failed", "err", err)
		os.Exit(1)
	}

	app := server.New(db, jwtCfg, googleCfg)

	// Maintenance job: periodically removes expired sessions and
	// verification_tokens (interval via PURGE_INTERVAL_MINUTES; 60min by default).
	// Stopped on graceful shutdown.
	stopPurge := jobs.StartPurge(db, time.Duration(config.EnvInt("PURGE_INTERVAL_MINUTES", 60))*time.Minute)

	// Orphan image sweep: an image removed from a board stays in storage, because
	// the client has no credential to delete it. Automatically disabled when no
	// bucket is configured.
	stopOrphans := jobs.StartOrphanSweep(
		db,
		storage.New(config.LoadR2()),
		time.Duration(config.EnvInt("ORPHAN_SWEEP_HOURS", 24))*time.Hour,
	)

	port := os.Getenv("PORT")
	if port == "" {
		port = "4000"
	}

	// Sobe o servidor em background para permitir shutdown gracioso.
	go func() {
		slog.Info("API no ar", "service", "omniboard", "addr", "http://localhost:"+port+"/api")
		if err := app.Listen(":" + port); err != nil {
			slog.Error("could not start the server", "err", err)
			os.Exit(1)
		}
	}()

	// Waits for a termination signal (Ctrl+C, deploy, orchestrator restart).
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit
	slog.Info("shutting down: draining in-flight requests")

	stopPurge()
	stopOrphans() // stops the maintenance job

	// Drains active connections before closing (up to 15s).
	if err := app.ShutdownWithTimeout(15 * time.Second); err != nil {
		slog.Error("error during shutdown", "err", err)
	}
	if sqlDB, err := db.DB(); err == nil {
		_ = sqlDB.Close()
	}
	slog.Info("server shut down cleanly")
}
