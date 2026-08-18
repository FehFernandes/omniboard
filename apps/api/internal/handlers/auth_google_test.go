package handlers

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/require"
)

// fakeIDToken builds a JWT with a decorative signature: decodeGoogleIDToken only
// reads the payload (see the rationale there), so the 3-part format is enough.
func fakeIDToken(t *testing.T, claims map[string]any) string {
	t.Helper()
	payload, err := json.Marshal(claims)
	require.NoError(t, err)
	enc := base64.RawURLEncoding.EncodeToString
	return strings.Join([]string{
		enc([]byte(`{"alg":"RS256","typ":"JWT"}`)),
		enc(payload),
		enc([]byte("unverified-signature")),
	}, ".")
}

func TestDecodeGoogleIDToken(t *testing.T) {
	token := fakeIDToken(t, map[string]any{
		"sub":            "1065407395663",
		"aud":            "client-abc",
		"iss":            "https://accounts.google.com",
		"email":          "pessoa@exemplo.com",
		"email_verified": true,
		"name":           "Pessoa Exemplo",
		"picture":        "https://lh3.googleusercontent.com/foto",
	})

	p, err := decodeGoogleIDToken(token)
	require.NoError(t, err)
	require.Equal(t, "1065407395663", p.Sub)
	require.Equal(t, "client-abc", p.Aud)
	require.Equal(t, "pessoa@exemplo.com", p.Email)
	require.True(t, p.EmailVerified)
	require.Equal(t, "Pessoa Exemplo", p.Name)
}

func TestDecodeGoogleIDTokenRejectsMalformed(t *testing.T) {
	cases := map[string]string{
		"empty":            "",
		"sem pontos":       "abcdef",
		"partes de menos":  "aaa.bbb",
		"non-b64 payload":  "aaa.!!!.ccc",
		"non-json payload": "aaa." + base64.RawURLEncoding.EncodeToString([]byte("not json")) + ".ccc",
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := decodeGoogleIDToken(token)
			require.Error(t, err)
		})
	}
}

// Without the `sub` claim there is no way to identify the user stably.
func TestDecodeGoogleIDTokenRequiresSub(t *testing.T) {
	token := fakeIDToken(t, map[string]any{"email": "a@b.com", "aud": "x"})
	_, err := decodeGoogleIDToken(token)
	require.ErrorContains(t, err, "sub")
}

func TestIsGoogleIssuer(t *testing.T) {
	require.True(t, isGoogleIssuer("accounts.google.com"))
	require.True(t, isGoogleIssuer("https://accounts.google.com"))
	require.False(t, isGoogleIssuer("https://evil.example.com"))
	require.False(t, isGoogleIssuer(""))
}

func TestSplitOAuthState(t *testing.T) {
	state, verifier, ok := splitOAuthState("abc.def")
	require.True(t, ok)
	require.Equal(t, "abc", state)
	require.Equal(t, "def", verifier)

	for _, bad := range []string{"", "semponto", ".def", "abc."} {
		_, _, ok := splitOAuthState(bad)
		require.False(t, ok, "cookie %q deveria ser rejeitado", bad)
	}
}

// Can the verifier contain dots? Not in our case (it is hex), but Cut takes only
// the first separator — we guarantee the rest stays intact in the verifier.
func TestSplitOAuthStateUsesFirstSeparator(t *testing.T) {
	state, verifier, ok := splitOAuthState("st.a.b")
	require.True(t, ok)
	require.Equal(t, "st", state)
	require.Equal(t, "a.b", verifier)
}

func TestTruncateRespectsLimitAndUTF8(t *testing.T) {
	require.Equal(t, "short", truncate("short", 10))
	require.Equal(t, "abcde", truncate("abcdefgh", 5))

	// A 2-byte UTF-8 character: cutting at 3 bytes must not split it.
	out := truncate("aéb", 3)
	require.True(t, utf8.ValidString(out), "the result must be valid UTF-8: %q", out)
	require.LessOrEqual(t, len(out), 3)

	// A long name with accents stays valid UTF-8 at the column limit (150).
	long := strings.Repeat("ç", 200)
	out = truncate(long, 150)
	require.True(t, utf8.ValidString(out))
	require.LessOrEqual(t, len(out), 150)
}
