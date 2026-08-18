package utils

import (
	"crypto/sha256"
	"encoding/hex"
)

// HashToken returns the SHA-256 (hex) of an opaque token.
//
// Used to persist refresh tokens and invite tokens: we store only the hash in
// the database, never the raw value. That way a database leak does not expose
// reusable tokens. Verification is done by re-hashing the received value and
// comparing it with the stored hash.
//
// SHA-256 (and not bcrypt) is adequate here because the input is already a
// high-entropy secret (32 random bytes or a signed JWT), not a human-chosen
// password subject to brute force.
func HashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
