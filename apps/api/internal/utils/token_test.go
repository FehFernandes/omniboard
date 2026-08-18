package utils

import (
	"regexp"
	"testing"
)

func TestHashTokenIsDeterministic(t *testing.T) {
	a := HashToken("meu-token-secreto")
	b := HashToken("meu-token-secreto")
	if a != b {
		t.Fatalf("HashToken should be deterministic: %q != %q", a, b)
	}
}

func TestHashTokenDiffersPerInput(t *testing.T) {
	if HashToken("token-a") == HashToken("token-b") {
		t.Fatal("different tokens should not produce the same hash")
	}
}

func TestHashTokenNotPlaintext(t *testing.T) {
	raw := "token-in-plain-text"
	if HashToken(raw) == raw {
		t.Fatal("the hash must not equal the raw value")
	}
}

func TestHashTokenFormat(t *testing.T) {
	// SHA-256 in hex = 64 characters [0-9a-f].
	h := HashToken("qualquer-coisa")
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(h) {
		t.Fatalf("formato inesperado de hash: %q", h)
	}
}
