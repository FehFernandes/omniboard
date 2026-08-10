package storage

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/joho/godotenv"
	"github.com/stretchr/testify/require"
)

// LIVE test against the real bucket. It does not run in the ordinary
// `go test ./...`: it depends on credentials and network.
//
//	R2_LIVE_TEST=1 go test ./internal/storage -run AoVivo -v
//
// It answers the question no offline test answers: are the credentials, the
// endpoint and the public access right? The full path is exercised — it signs,
// uploads, reads through the public URL and deletes the test object.
//
// A 403 here is credential/permission (the signature is already verified against
// AWS' official vector in TestSigV4OfficialAWSVector).

// Transparent 1x1 PNG: the smallest valid file for the test.
const minimalPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAX+aYogAAAABJRU5ErkJggg=="

func liveClient(t *testing.T) *Client {
	t.Helper()
	if os.Getenv("R2_LIVE_TEST") == "" {
		t.Skip("teste ao vivo desligado (defina R2_LIVE_TEST=1)")
	}
	// Loads the API's .env if the variables do not come from the environment.
	if os.Getenv("R2_BUCKET") == "" {
		_ = godotenv.Load("../../.env")
	}

	endpoint := os.Getenv("R2_ENDPOINT")
	if endpoint == "" {
		if acc := os.Getenv("R2_ACCOUNT_ID"); acc != "" {
			endpoint = "https://" + acc + ".r2.cloudflarestorage.com"
		}
	}
	cfg := Config{
		Endpoint:        endpoint,
		Bucket:          os.Getenv("R2_BUCKET"),
		AccessKeyID:     os.Getenv("R2_ACCESS_KEY_ID"),
		SecretAccessKey: os.Getenv("R2_SECRET_ACCESS_KEY"),
		PublicBaseURL:   os.Getenv("R2_PUBLIC_BASE_URL"),
		Region:          "auto",
		MaxBytes:        10 * 1024 * 1024,
		Expires:         5 * time.Minute,
	}
	cl := New(cfg)
	if !cl.Config().Enabled() {
		t.Fatalf("incomplete configuration: fill in R2_ACCOUNT_ID (or R2_ENDPOINT), "+
			"R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_PUBLIC_BASE_URL. "+
			"Endpoint=%q Bucket=%q PublicBaseURL=%q chaves=%v",
			cfg.Endpoint, cfg.Bucket, cfg.PublicBaseURL,
			cfg.AccessKeyID != "" && cfg.SecretAccessKey != "")
	}
	return cl
}

func TestR2Live(t *testing.T) {
	cl := liveClient(t)
	body, err := base64.StdEncoding.DecodeString(minimalPNG)
	require.NoError(t, err)

	http.DefaultClient.Timeout = 30 * time.Second

	// 1) Sign.
	up, err := cl.PresignImage("selftest", "selftest.png", "image/png", int64(len(body)))
	require.NoError(t, err, "signing failed")
	t.Logf("key:        %s", up.Key)
	t.Logf("public:     %s", up.PublicURL)

	// 2) Upload straight to the bucket, as the browser would.
	req, err := http.NewRequest(http.MethodPut, up.UploadURL, bytes.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", up.ContentType)
	res, err := http.DefaultClient.Do(req)
	require.NoError(t, err, "network failure on the PUT")
	defer res.Body.Close()
	detail, _ := io.ReadAll(res.Body)
	require.Truef(t, res.StatusCode >= 200 && res.StatusCode < 300,
		"o bucket recusou o upload: %d\n%s\n"+
			"403 usually means a token without 'Object Read & Write' or scoped to another bucket; "+
			"404 usually means the bucket name is wrong.", res.StatusCode, detail)
	t.Logf("upload:     %d OK", res.StatusCode)

	// 3) Read through the public URL — that is how the canvas loads the image, with
	//    no authentication header. A failure here = public access off or wrong base.
	getRes, err := http.Get(up.PublicURL)
	require.NoError(t, err, "network failure on the public GET")
	defer getRes.Body.Close()
	lido, _ := io.ReadAll(getRes.Body)
	require.Equalf(t, http.StatusOK, getRes.StatusCode,
		"the public URL did not return the image: %d\n"+
			"Enable Public access on the bucket (or point R2_PUBLIC_BASE_URL at the domain "+
			"conectado a ele).", getRes.StatusCode)
	require.Equal(t, body, lido, "the content read back differs from what was sent")
	t.Logf("leitura:    %d OK (%d bytes)", getRes.StatusCode, len(lido))

	// 4) Clean up: the test leaves no garbage in the bucket.
	del := cl.presign(
		"DELETE",
		"https",
		hostDoEndpoint(t, cl.Config().Endpoint),
		"/"+encodePath(cl.Config().Bucket)+"/"+encodePath(up.Key),
		[][2]string{{"host", hostDoEndpoint(t, cl.Config().Endpoint)}},
		time.Now().UTC(),
	)
	delReq, err := http.NewRequest(http.MethodDelete, del, nil)
	require.NoError(t, err)
	delRes, err := http.DefaultClient.Do(delReq)
	if err == nil {
		defer delRes.Body.Close()
		t.Logf("deletion:   %d", delRes.StatusCode)
	}

	fmt.Println("R2 OK: signing, upload and public read all working.")
}

func hostDoEndpoint(t *testing.T, endpoint string) string {
	t.Helper()
	semEsquema := endpoint
	for _, p := range []string{"https://", "http://"} {
		if len(semEsquema) > len(p) && semEsquema[:len(p)] == p {
			semEsquema = semEsquema[len(p):]
		}
	}
	if i := bytes.IndexByte([]byte(semEsquema), '/'); i > 0 {
		semEsquema = semEsquema[:i]
	}
	return semEsquema
}

// The DELETE signature needs the same rules as the PUT: this test runs offline
// and guarantees the method goes into the canonical request (changing the method
// changes the signature).
func TestPresignDeleteDiffersFromPut(t *testing.T) {
	cl := fixedClient(t)
	when := time.Now().UTC()
	put := cl.presign("PUT", "https", "h.example", "/b/k.png",
		[][2]string{{"host", "h.example"}}, when)
	del := cl.presign("DELETE", "https", "h.example", "/b/k.png",
		[][2]string{{"host", "h.example"}}, when)
	require.NotEqual(t, put, del)
}
