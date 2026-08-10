# Makefile — OmniBoard API
# Requires Go and Docker (compose). On Windows use WSL, Git Bash, or run the
# commands by hand.

DB_DEV  ?= omniboard_dev
DB_TEST ?= omniboard_test

.PHONY: help up down reset-db db-create run build test test-unit tidy fmt vet migrate-up migrate-down migrate-version

help: ## List the available commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

up: ## Start Postgres + Redis (root docker-compose.yml)
	docker compose -f ../../docker-compose.yml up -d

down: ## Stop the containers
	docker compose -f ../../docker-compose.yml down

reset-db: ## Recreate the database volume (DELETES all data)
	docker compose -f ../../docker-compose.yml down -v
	docker compose -f ../../docker-compose.yml up -d

db-create: ## Create the dev and test databases (idempotent)
	@docker compose -f ../../docker-compose.yml exec -T postgres createdb -U postgres $(DB_DEV) 2>/dev/null || true
	@docker compose -f ../../docker-compose.yml exec -T postgres createdb -U postgres $(DB_TEST) 2>/dev/null || true
	@echo "databases ready: $(DB_DEV), $(DB_TEST)"

run: ## Run the API locally (uses .env / defaults)
	go run ./cmd/server

migrate-up: ## Apply the versioned migrations (golang-migrate)
	go run ./cmd/migrate up

migrate-down: ## Roll back versioned migration(s) — use N=2 to roll back 2
	go run ./cmd/migrate down $(N)

migrate-version: ## Show the current migration version
	go run ./cmd/migrate version

build: ## Compile the binary into bin/server
	go build -o bin/server ./cmd/server

test: ## Run every test (needs the test database up)
	go test ./...

test-unit: ## Run only the tests that do not need a database
	go test ./internal/utils/...

tidy: ## Tidy go.mod/go.sum
	go mod tidy

fmt: ## Format the code
	go fmt ./...

vet: ## Static analysis
	go vet ./...
