package config

import (
	"os"
	"strconv"
)

// getEnv returns the value of an environment variable or a fallback.
func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// envInt reads an environment variable as a positive integer, or uses the fallback.
func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}

// EnvInt is the exported version of envInt: reads an env variable as a positive
// integer, or uses the fallback. Useful outside the config package (e.g.: main).
func EnvInt(key string, fallback int) int {
	return envInt(key, fallback)
}

// IsProduction reports whether the environment is production.
func IsProduction() bool {
	return os.Getenv("ENV") == "production"
}

// IsDevelopment reports whether the environment is development.
func IsDevelopment() bool {
	return os.Getenv("ENV") == "development"
}
