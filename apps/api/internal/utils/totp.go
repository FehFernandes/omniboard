package utils

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// TOTP (RFC 6238) implemented with the stdlib only — no external dependencies.
//
// Parameters compatible with Google Authenticator/Authy/1Password: SHA1, 6
// digits, 30s window. Validation accepts ±1 window (totpSkew) to tolerate a
// small clock drift between server and phone.
const (
	totpStep   = 30 // seconds per window
	totpDigits = 6
	totpSkew   = 1 // tolerance windows on each side
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// GenerateTOTPSecret creates a random secret (160 bits) encoded in base32,
// ready to become an otpauth:// QR code.
func GenerateTOTPSecret() (string, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return b32.EncodeToString(b), nil
}

// hotp implements HOTP (RFC 4226): dynamic truncation of the HMAC-SHA1.
func hotp(key []byte, counter uint64, digits int) string {
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(buf)
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	bin := (uint32(sum[offset]&0x7f) << 24) |
		(uint32(sum[offset+1]) << 16) |
		(uint32(sum[offset+2]) << 8) |
		uint32(sum[offset+3])

	mod := uint32(1)
	for i := 0; i < digits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", digits, bin%mod)
}

// totpAt computes the TOTP code for an instant, step and number of digits.
func totpAt(secretB32 string, t time.Time, step, digits int) (string, error) {
	key, err := b32.DecodeString(strings.ToUpper(strings.TrimSpace(secretB32)))
	if err != nil {
		return "", err
	}
	counter := uint64(t.Unix() / int64(step))
	return hotp(key, counter, digits), nil
}

// TOTPCode returns the current code (6 digits) for a base32 secret.
func TOTPCode(secret string, t time.Time) (string, error) {
	return totpAt(secret, t, totpStep, totpDigits)
}

// ValidateTOTP checks a code against the secret, accepting ±1 window of skew.
// Constant-time comparison (does not leak timing).
func ValidateTOTP(secret, code string) bool {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return false
	}
	now := time.Now()
	for i := -totpSkew; i <= totpSkew; i++ {
		want, err := totpAt(secret, now.Add(time.Duration(i*totpStep)*time.Second), totpStep, totpDigits)
		if err != nil {
			return false
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return true
		}
	}
	return false
}

// OTPAuthURL builds the otpauth:// URI that the authenticator app reads via QR
// code. The front end can render the QR from this string (or show the secret).
func OTPAuthURL(secret, issuer, account string) string {
	label := url.PathEscape(issuer + ":" + account)
	v := url.Values{}
	v.Set("secret", secret)
	v.Set("issuer", issuer)
	v.Set("algorithm", "SHA1")
	v.Set("digits", strconv.Itoa(totpDigits))
	v.Set("period", strconv.Itoa(totpStep))
	return "otpauth://totp/" + label + "?" + v.Encode()
}
