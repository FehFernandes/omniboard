package storage

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fixedClient returns a deterministic Client (date and id pinned), so the tests
// can assert on the entire URL.
func fixedClient(t *testing.T, ajustes ...func(*Config)) *Client {
	t.Helper()
	cfg := Config{
		Endpoint:        "https://acc123.r2.cloudflarestorage.com",
		Bucket:          "omniboard",
		AccessKeyID:     "AKIAIOSFODNN7EXAMPLE",
		SecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		PublicBaseURL:   "https://cdn.exemplo.com",
		Region:          "auto",
		MaxBytes:        1024,
		Expires:         5 * time.Minute,
	}
	for _, a := range ajustes {
		a(&cfg)
	}
	cl := New(cfg)
	cl.now = func() time.Time { return time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC) }
	cl.newID = func() string { return "0000-fixo" }
	return cl
}

func TestPresignImage(t *testing.T) {
	cl := fixedClient(t)

	up, err := cl.PresignImage("user-42", "foto.png", "image/png", 500)
	require.NoError(t, err)

	// The key isolates by owner and is not guessable from the original name.
	assert.Equal(t, "u/user-42/0000-fixo.png", up.Key)
	assert.NotContains(t, up.Key, "foto")
	assert.Equal(t, "https://cdn.exemplo.com/u/user-42/0000-fixo.png", up.PublicURL)
	assert.Equal(t, "image/png", up.ContentType)
	assert.Equal(t, int64(1024), up.MaxBytes)
	assert.Equal(t, 300, up.ExpiresIn)

	u, err := url.Parse(up.UploadURL)
	require.NoError(t, err)
	assert.Equal(t, "acc123.r2.cloudflarestorage.com", u.Host)
	// Path-style: the bucket goes into the path.
	assert.Equal(t, "/omniboard/u/user-42/0000-fixo.png", u.Path)

	q := u.Query()
	assert.Equal(t, "AWS4-HMAC-SHA256", q.Get("X-Amz-Algorithm"))
	assert.Equal(t, "AKIAIOSFODNN7EXAMPLE/20260730/auto/s3/aws4_request", q.Get("X-Amz-Credential"))
	assert.Equal(t, "20260730T120000Z", q.Get("X-Amz-Date"))
	assert.Equal(t, "300", q.Get("X-Amz-Expires"))
	// signed content-type: the client is forced to repeat the same header.
	assert.Equal(t, "content-type;host", q.Get("X-Amz-SignedHeaders"))
	assert.Len(t, q.Get("X-Amz-Signature"), 64)
}

// The signature has to be stable: same input, same output. That is what allows
// debugging a 403 from the bucket without guesswork.
func TestPresignIsDeterministic(t *testing.T) {
	a, err := fixedClient(t).PresignImage("user-42", "foto.png", "image/png", 500)
	require.NoError(t, err)
	b, err := fixedClient(t).PresignImage("user-42", "foto.png", "image/png", 500)
	require.NoError(t, err)
	assert.Equal(t, a.UploadURL, b.UploadURL)
}

func TestPresignChangesWithInput(t *testing.T) {
	base, err := fixedClient(t).PresignImage("user-42", "a.png", "image/png", 500)
	require.NoError(t, err)

	// Different content-type → different signature (it is in SignedHeaders).
	outroTipo, err := fixedClient(t).PresignImage("user-42", "a.webp", "image/webp", 500)
	require.NoError(t, err)
	assert.NotEqual(t, sig(t, base.UploadURL), sig(t, outroTipo.UploadURL))

	// Different secret → different signature.
	otherSecret, err := fixedClient(t, func(c *Config) { c.SecretAccessKey = "other" }).
		PresignImage("user-42", "a.png", "image/png", 500)
	require.NoError(t, err)
	assert.NotEqual(t, sig(t, base.UploadURL), sig(t, otherSecret.UploadURL))
}

func sig(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	return u.Query().Get("X-Amz-Signature")
}

/**
 * AWS' official vector for a presigned URL (SigV4 by query string):
 * "Example: Signature calculation for presigned URL" — GET of examplebucket/test.txt,
 * 20130524T000000Z, expires in 86400s, signing only `host`, with UNSIGNED-PAYLOAD.
 *
 * Reproducing the published signature is what guarantees the implementation is
 * right. Without it, a bucket 403 would be indistinguishable from an algorithm bug.
 */
func TestSigV4OfficialAWSVector(t *testing.T) {
	cl := New(Config{
		AccessKeyID:     "AKIAIOSFODNN7EXAMPLE",
		SecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		Region:          "us-east-1",
		Expires:         86400 * time.Second,
	})
	when := time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC)

	raw := cl.presign(
		"GET",
		"https",
		"examplebucket.s3.amazonaws.com",
		"/test.txt",
		[][2]string{{"host", "examplebucket.s3.amazonaws.com"}},
		when,
	)

	u, err := url.Parse(raw)
	require.NoError(t, err)
	assert.Equal(t,
		"aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
		u.Query().Get("X-Amz-Signature"),
	)
}

func TestPresignValidation(t *testing.T) {
	cl := fixedClient(t)

	_, err := cl.PresignImage("u", "x.svg", "image/svg+xml", 10)
	assert.ErrorIs(t, err, ErrContentType, "SVG executa script: fica fora da allowlist")

	_, err = cl.PresignImage("u", "x.exe", "application/octet-stream", 10)
	assert.ErrorIs(t, err, ErrContentType)

	_, err = cl.PresignImage("u", "x.png", "image/png", 0)
	assert.ErrorIs(t, err, ErrEmpty)

	_, err = cl.PresignImage("u", "x.png", "image/png", 1025)
	assert.ErrorIs(t, err, ErrTooLarge, "the limit is 1024 in the test client")

	// Header parameters (charset) must not get in the way of the match.
	up, err := cl.PresignImage("u", "x.png", "IMAGE/PNG; charset=binary", 10)
	require.NoError(t, err)
	assert.Equal(t, "image/png", up.ContentType)
}

func TestPresignWithoutConfiguration(t *testing.T) {
	cl := New(Config{})
	assert.False(t, cl.Config().Enabled())
	_, err := cl.PresignImage("u", "x.png", "image/png", 10)
	assert.ErrorIs(t, err, ErrNotConfigured)
}

// The owner comes from the JWT, but we never trust it to build a path.
func TestKeySanitizesOwner(t *testing.T) {
	cl := fixedClient(t)
	up, err := cl.PresignImage("../../etc/passwd", "x.png", "image/png", 10)
	require.NoError(t, err)
	assert.Equal(t, "u/etcpasswd/0000-fixo.png", up.Key)
	assert.NotContains(t, up.Key, "..")

	up, err = cl.PresignImage("", "x.png", "image/png", 10)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(up.Key, "u/anon/"))
}

func TestExtensionFollowsTheContentType(t *testing.T) {
	cl := fixedClient(t)
	// Name lying about the type: the content-type wins.
	up, err := cl.PresignImage("u", "foto.png", "image/webp", 10)
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(up.Key, ".webp"))

	// .jpeg is accepted as a legitimate variation of image/jpeg.
	up, err = cl.PresignImage("u", "foto.JPEG", "image/jpeg", 10)
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(up.Key, ".jpeg"))
}

func TestPublicURLHasNoDoubleSlash(t *testing.T) {
	cl := fixedClient(t, func(c *Config) { c.PublicBaseURL = "https://cdn.exemplo.com/" })
	up, err := cl.PresignImage("u", "x.png", "image/png", 10)
	require.NoError(t, err)
	assert.Equal(t, "https://cdn.exemplo.com/u/u/0000-fixo.png", up.PublicURL)
	assert.NotContains(t, strings.TrimPrefix(up.PublicURL, "https://"), "//")
}

func TestUriEncode(t *testing.T) {
	// SigV4 requires encoding everything outside A-Za-z0-9-_.~ — including "/" and ":".
	assert.Equal(t, "a%2Fb", uriEncode("a/b", true))
	assert.Equal(t, "a/b", uriEncode("a/b", false))
	assert.Equal(t, "AKIA%2F20260730%2Fauto", uriEncode("AKIA/20260730/auto", true))
	assert.Equal(t, "-_.~", uriEncode("-_.~", true))
	assert.Equal(t, "%20", uriEncode(" ", true))
}

func TestEncodeQueryIsSorted(t *testing.T) {
	q := url.Values{}
	q.Set("X-Amz-Date", "20260730T120000Z")
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	// Alphabetical order by key, as the algorithm demands.
	assert.Equal(t,
		"X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260730T120000Z",
		encodeQuery(q))
}

func TestDerivedEndpointAcceptsPathStyle(t *testing.T) {
	cl := fixedClient(t, func(c *Config) { c.Bucket = "meu bucket" })
	up, err := cl.PresignImage("u", "x.png", "image/png", 10)
	require.NoError(t, err)
	// A bucket name with a space must appear encoded in the path.
	assert.Contains(t, up.UploadURL, "/meu%20bucket/")
}
