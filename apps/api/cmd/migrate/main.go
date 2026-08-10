// Versioned migrations command (golang-migrate).
//
//	go run ./cmd/migrate up            # apply pending migrations
//	go run ./cmd/migrate down [n]      # roll back n (default 1)
//	go run ./cmd/migrate version       # current version (+ dirty flag)
//	go run ./cmd/migrate force <v>     # unstick a "dirty" schema
//
// Uses the same environment variables as the app (DB_HOST, DB_USER, …).
package main

import (
	"log"
	"os"
	"strconv"

	"github.com/cachyosso/omniboard/internal/config"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	if len(os.Args) < 2 {
		usage()
	}

	switch os.Args[1] {
	case "up":
		must(config.RunMigrations())
		log.Println("✅ migrations applied")
	case "down":
		steps := 1
		if len(os.Args) > 2 {
			steps = atoi(os.Args[2])
		}
		must(config.MigrateDown(steps))
		log.Printf("✅ rolled back %d migration(s)", steps)
	case "version":
		v, dirty, err := config.MigrateVersion()
		must(err)
		log.Printf("current version: %d (dirty=%v)", v, dirty)
	case "force":
		if len(os.Args) < 3 {
			log.Fatal("usage: migrate force <version>")
		}
		must(config.MigrateForce(atoi(os.Args[2])))
		log.Printf("✅ version forced to %s", os.Args[2])
	default:
		usage()
	}
}

func usage() {
	log.Fatal("uso: migrate <up | down [n] | version | force <v>>")
}

func must(err error) {
	if err != nil {
		log.Fatalf("error: %v", err)
	}
}

func atoi(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		log.Fatalf("invalid number: %s", s)
	}
	return n
}
