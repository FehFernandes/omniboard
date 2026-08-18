package utils

import (
	"testing"
	"time"
)

// TestHOTPRFC6238Vectors validates the implementation against the official RFC
// 6238 vectors (Appendix B), ASCII seed "12345678901234567890", SHA1, 8 digits.
func TestHOTPRFC6238Vectors(t *testing.T) {
	key := []byte("12345678901234567890")
	cases := []struct {
		sec  int64
		want string
	}{
		{59, "94287082"},
		{1111111109, "07081804"},
		{1111111111, "14050471"},
		{1234567890, "89005924"},
		{2000000000, "69279037"},
		{20000000000, "65353130"},
	}
	for _, tc := range cases {
		counter := uint64(tc.sec / 30)
		if got := hotp(key, counter, 8); got != tc.want {
			t.Errorf("T=%d: hotp=%s, esperado %s", tc.sec, got, tc.want)
		}
	}
}

func TestTOTPRoundTrip(t *testing.T) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("generating the secret: %v", err)
	}
	code, err := TOTPCode(secret, time.Now())
	if err != nil {
		t.Fatalf("generating the code: %v", err)
	}
	if len(code) != totpDigits {
		t.Fatalf("code has %d digits, expected %d", len(code), totpDigits)
	}
	if !ValidateTOTP(secret, code) {
		t.Errorf("the generated code should validate")
	}
}

func TestOTPAuthURL(t *testing.T) {
	u := OTPAuthURL("ABC234", "MeuApp", "user@example.com")
	for _, want := range []string{"otpauth://totp/", "secret=ABC234", "issuer=MeuApp", "digits=6", "period=30"} {
		if !contains(u, want) {
			t.Errorf("URL otpauth sem %q: %s", want, u)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && indexOf(s, sub) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
