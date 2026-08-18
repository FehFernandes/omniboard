// Package storage — file upload to an S3-compatible bucket (Cloudflare R2),
// via presigned URL.
//
// Why presign instead of receiving the file: the binary never touches the bytes.
// The client PUTs straight to R2, so the upload does not go through the API's
// BodyLimit (10MB), does not consume server memory/CPU and does not pay egress
// bandwidth twice. The server only decides *whether* it may and *where* to write.
//
// The signature is SigV4 by query string, implemented here with the standard
// library. Pulling in the whole AWS SDK (dozens of modules) to generate a URL
// does not pay off — the algorithm is public, stable and covered by tests with
// fixed vectors (see r2_test.go).
package storage

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Bucket config. Comes from the environment (see config.LoadR2).
type Config struct {
	// Endpoint of the bucket's S3 API, e.g.:
	// https://<accountid>.r2.cloudflarestorage.com
	Endpoint        string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	// Public read base (own domain or r2.dev), e.g.:
	// https://cdn.example.com. No trailing slash.
	PublicBaseURL string
	// Signature region. R2 uses "auto".
	Region string
	// Maximum accepted size per file, in bytes.
	MaxBytes int64
	// Lifetime of the upload URL.
	Expires time.Duration
}

// Enabled reports whether there is enough configuration to sign uploads.
func (c Config) Enabled() bool {
	return c.Endpoint != "" && c.Bucket != "" && c.AccessKeyID != "" &&
		c.SecretAccessKey != "" && c.PublicBaseURL != ""
}

// Validation errors (the handler maps them to 4xx).
var (
	ErrNotConfigured = errors.New("storage: bucket is not configured")
	ErrContentType   = errors.New("storage: file type is not allowed")
	ErrTooLarge      = errors.New("storage: file larger than the limit")
	ErrEmpty         = errors.New("storage: empty file")
)

// AllowedImageTypes — allowlist of images accepted on the canvas.
//
// Allowlist, and not blocklist: an SVG, for example, executes script when served
// from the same domain, and the gain of accepting it does not offset the risk.
var AllowedImageTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
	"image/avif": ".avif",
}

// Client signs URLs for a bucket.
type Client struct {
	cfg Config
	// now is injectable so the test can get deterministic vectors.
	now func() time.Time
	// newID is injectable for the same reason.
	newID func() string
}

func New(cfg Config) *Client {
	if cfg.Region == "" {
		cfg.Region = "auto"
	}
	if cfg.Expires <= 0 {
		cfg.Expires = 5 * time.Minute
	}
	if cfg.MaxBytes <= 0 {
		cfg.MaxBytes = 10 * 1024 * 1024
	}
	return &Client{cfg: cfg, now: time.Now, newID: func() string { return uuid.NewString() }}
}

// Config returns the effective configuration (limits are useful to the client).
func (cl *Client) Config() Config { return cl.cfg }

// Upload describes where the client writes and where the image is read from later.
type Upload struct {
	// URL for the PUT (expires).
	UploadURL string `json:"upload_url"`
	// Stable URL, stored in the board element.
	PublicURL string `json:"public_url"`
	Key       string `json:"key"`
	// Header required on the PUT (part of the signature).
	ContentType string `json:"content_type"`
	ExpiresIn   int    `json:"expires_in"`
	MaxBytes    int64  `json:"max_bytes"`
}

// PresignImage validates the request and returns the upload URL.
//
// `ownerID` isolates the files per user in the key prefix; `name` is used only
// to preserve the extension — the real key is random, so the object is not
// guessable (the bucket serves public reads).
func (cl *Client) PresignImage(ownerID, name, contentType string, size int64) (*Upload, error) {
	if !cl.cfg.Enabled() {
		return nil, ErrNotConfigured
	}
	ct := strings.ToLower(strings.TrimSpace(contentType))
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	ext, ok := AllowedImageTypes[ct]
	if !ok {
		return nil, ErrContentType
	}
	if size <= 0 {
		return nil, ErrEmpty
	}
	if size > cl.cfg.MaxBytes {
		return nil, ErrTooLarge
	}
	// The extension of the original name counts if it is coherent with the
	// content-type (jpeg/jpg), otherwise we use the canonical one.
	if e := strings.ToLower(path.Ext(name)); e == ".jpeg" && ext == ".jpg" {
		ext = e
	}

	key := fmt.Sprintf("u/%s/%s%s", sanitizeSegment(ownerID), cl.newID(), ext)
	uploadURL, err := cl.presignPut(key, ct, cl.now().UTC())
	if err != nil {
		return nil, err
	}
	return &Upload{
		UploadURL:   uploadURL,
		PublicURL:   strings.TrimRight(cl.cfg.PublicBaseURL, "/") + "/" + key,
		Key:         key,
		ContentType: ct,
		ExpiresIn:   int(cl.cfg.Expires.Seconds()),
		MaxBytes:    cl.cfg.MaxBytes,
	}, nil
}

// sanitizeSegment keeps only what is safe in an object path.
func sanitizeSegment(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '-', r == '_':
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "anon"
	}
	return b.String()
}

// presignPut builds the signed URL (SigV4, query string) for a PUT.
//
// The content-type goes into SignedHeaders, so the client is forced to send
// exactly the same value — you cannot sign a PNG and upload something else.
func (cl *Client) presignPut(key, contentType string, now time.Time) (string, error) {
	u, err := url.Parse(cl.cfg.Endpoint)
	if err != nil {
		return "", fmt.Errorf("storage: invalid endpoint: %w", err)
	}
	// Path-style: <endpoint>/<bucket>/<key>. R2 accepts it, and it avoids
	// depending on per-bucket DNS.
	canonicalURI := "/" + encodePath(cl.cfg.Bucket) + "/" + encodePath(key)
	hdrs := [][2]string{{"content-type", contentType}, {"host", u.Host}}
	return cl.presign("PUT", u.Scheme, u.Host, canonicalURI, hdrs, now), nil
}

// presign implements SigV4 by query string.
//
// It is separate from presignPut so the test can reproduce AWS' official vector
// (a GET signing only `host`) — that is what guarantees a 403 from the bucket is
// a credential problem, not an algorithm one.
func (cl *Client) presign(
	method, scheme, host, canonicalURI string,
	hdrs [][2]string,
	now time.Time,
) string {
	return cl.presignComQuery(method, scheme, host, canonicalURI, nil, hdrs, now)
}

// presignComQuery signs including query parameters specific to the operation
// (e.g.: list-type=2&prefix=... in ListObjectsV2).
//
// Order of the algorithm: canonical request → string to sign → key derived by
// date/region/service → signature. `hdrs` must come in alphabetical order of
// name (it is what goes into CanonicalHeaders and SignedHeaders), and the WHOLE
// query (including the operation's own) goes into the canonical request —
// forgetting a parameter here results in a 403 from the bucket.
func (cl *Client) presignComQuery(
	method, scheme, host, canonicalURI string,
	extra url.Values,
	hdrs [][2]string,
	now time.Time,
) string {
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	scope := strings.Join([]string{dateStamp, cl.cfg.Region, "s3", "aws4_request"}, "/")

	names := make([]string, 0, len(hdrs))
	var canonicalHeaders strings.Builder
	for _, h := range hdrs {
		names = append(names, h[0])
		canonicalHeaders.WriteString(h[0] + ":" + h[1] + "\n")
	}
	signedHeaders := strings.Join(names, ";")

	q := url.Values{}
	for k, vs := range extra {
		for _, v := range vs {
			q.Add(k, v)
		}
	}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", cl.cfg.AccessKeyID+"/"+scope)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", fmt.Sprintf("%d", int(cl.cfg.Expires.Seconds())))
	q.Set("X-Amz-SignedHeaders", signedHeaders)

	canonicalRequest := strings.Join([]string{
		method,
		canonicalURI,
		encodeQuery(q),
		canonicalHeaders.String(),
		signedHeaders,
		// Unsigned payload: the server does not know the content.
		"UNSIGNED-PAYLOAD",
	}, "\n")

	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256Hex(canonicalRequest),
	}, "\n")

	signing := hmacSHA256(
		hmacSHA256(
			hmacSHA256(
				hmacSHA256([]byte("AWS4"+cl.cfg.SecretAccessKey), dateStamp),
				cl.cfg.Region,
			),
			"s3",
		),
		"aws4_request",
	)
	q.Set("X-Amz-Signature", hex.EncodeToString(hmacSHA256(signing, stringToSign)))

	return scheme + "://" + host + canonicalURI + "?" + encodeQuery(q)
}

// encodeQuery sorts and encodes the parameters as SigV4 requires (RFC 3986,
// including for "/" and ":", which url.Values.Encode would let through).
func encodeQuery(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		for _, v := range q[k] {
			parts = append(parts, uriEncode(k, true)+"="+uriEncode(v, true))
		}
	}
	return strings.Join(parts, "&")
}

// encodePath encodes each path segment preserving the slashes.
func encodePath(p string) string {
	segs := strings.Split(p, "/")
	for i, s := range segs {
		segs[i] = uriEncode(s, true)
	}
	return strings.Join(segs, "/")
}

// uriEncode implements SigV4's UriEncode: only A-Z a-z 0-9 -_.~ stay literal.
func uriEncode(s string, encodeSlash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9',
			c == '-', c == '_', c == '.', c == '~':
			b.WriteByte(c)
		case c == '/' && !encodeSlash:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
