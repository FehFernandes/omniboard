package jobs_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/datatypes"

	"github.com/FehFernandes/omniboard/internal/jobs"
	"github.com/FehFernandes/omniboard/internal/storage"
)

// Fake bucket, S3-compatible in what the sweep uses: ListObjectsV2 and DELETE.
//
// It serves to exercise the decision rule (what to delete) without touching the
// real R2 — a test that really deletes is a test nobody runs.
type bucketFalso struct {
	mu       sync.Mutex
	objetos  map[string]objetoFalso
	deleted  []string
	servidor *httptest.Server
}

type objetoFalso struct {
	size     int64
	modified time.Time
}

func newFakeBucket(objetos map[string]objetoFalso) *bucketFalso {
	b := &bucketFalso{objetos: objetos}
	b.servidor = httptest.NewServer(http.HandlerFunc(b.handle))
	return b
}

func (b *bucketFalso) handle(w http.ResponseWriter, r *http.Request) {
	b.mu.Lock()
	defer b.mu.Unlock()

	// Every request must come signed.
	if r.URL.Query().Get("X-Amz-Signature") == "" {
		w.WriteHeader(http.StatusForbidden)
		return
	}

	if r.Method == http.MethodDelete {
		key := strings.TrimPrefix(r.URL.Path, "/bucket-teste/")
		delete(b.objetos, key)
		b.deleted = append(b.deleted, key)
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method == http.MethodGet && r.URL.Query().Get("list-type") == "2" {
		prefix := r.URL.Query().Get("prefix")
		var sb strings.Builder
		sb.WriteString(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>`)
		for key, o := range b.objetos {
			if prefix != "" && !strings.HasPrefix(key, prefix) {
				continue
			}
			fmt.Fprintf(&sb,
				`<Contents><Key>%s</Key><Size>%d</Size><LastModified>%s</LastModified></Contents>`,
				key, o.size, o.modified.UTC().Format(time.RFC3339))
		}
		sb.WriteString(`</ListBucketResult>`)
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(sb.String()))
		return
	}

	w.WriteHeader(http.StatusBadRequest)
}

func (b *bucketFalso) client() *storage.Client {
	return storage.New(storage.Config{
		Endpoint:        b.servidor.URL,
		Bucket:          "bucket-teste",
		AccessKeyID:     "key",
		SecretAccessKey: "secret",
		PublicBaseURL:   "https://cdn.teste",
		Region:          "auto",
		MaxBytes:        10 << 20,
		Expires:         5 * time.Minute,
	})
}

func (b *bucketFalso) exists(key string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	_, ok := b.objetos[key]
	return ok
}

/** Workspace referencing the given URLs. */
func workspaceComImagens(urls ...string) datatypes.JSON {
	elementos := make([]any, 0, len(urls))
	for i, u := range urls {
		elementos = append(elementos, map[string]any{
			"id": fmt.Sprintf("el-%d", i), "type": "image", "src": u,
		})
	}
	env := map[string]any{
		"type": "omniboard-workspace-envelope",
		"workspace": map[string]any{
			"documents": []any{
				map[string]any{
					"id": "b1", "name": "Board 1",
					"snapshot": map[string]any{"type": "openboard", "elements": elementos},
				},
			},
		},
	}
	b, _ := json.Marshal(env)
	return b
}

// user_id is a uuid in the table: the test needs a valid id, and the bucket
// prefix is derived from it (see storage.UserPrefix).
const user = "3f7c1e2a-0000-4000-8000-000000000001"
const otherUser = "3f7c1e2a-0000-4000-8000-000000000002"

func key(userID, name string) string { return "u/" + userID + "/" + name }
func urlPublica(userID, name string) string {
	return "https://cdn.teste/" + key(userID, name)
}

func TestSweepDeletesOnlyOldOrphans(t *testing.T) {
	db := newDB(t)
	old := time.Now().Add(-72 * time.Hour)
	recente := time.Now().Add(-1 * time.Hour)

	b := newFakeBucket(map[string]objetoFalso{
		key(user, "usada.png"):         {size: 100, modified: old},
		key(user, "orfa-velha.png"):    {size: 200, modified: old},
		key(user, "orfa-recente.png"):  {size: 300, modified: recente},
		key(otherUser, "not-mine.png"): {size: 400, modified: old},
	})
	defer b.servidor.Close()

	inserirWorkspace(t, db, user, workspaceComImagens(urlPublica(user, "usada.png")))

	r, err := jobs.SweepOrphans(context.Background(), db, b.client(), jobs.OrphanGrace)
	require.NoError(t, err)

	require.Equal(t, 1, r.Deleted)
	require.Equal(t, int64(200), r.BytesLiberados)
	require.Equal(t, 1, r.MantidosPorGraca, "a recent upload is not deleted")

	require.True(t, b.exists(key(user, "usada.png")), "an image in use cannot be removed")
	require.False(t, b.exists(key(user, "orfa-velha.png")))
	require.True(t, b.exists(key(user, "orfa-recente.png")))
	// Another user's prefix is not even looked at.
	require.True(t, b.exists(key(otherUser, "not-mine.png")))
}

// The asymmetric error: deleting a live image is lost work.
func TestSweepKeepsReferencedImage(t *testing.T) {
	db := newDB(t)
	old := time.Now().Add(-100 * time.Hour)
	b := newFakeBucket(map[string]objetoFalso{
		key(user, "a.png"): {size: 1, modified: old},
		key(user, "b.png"): {size: 1, modified: old},
		key(user, "c.png"): {size: 1, modified: old},
	})
	defer b.servidor.Close()

	inserirWorkspace(t, db, user, workspaceComImagens(
		urlPublica(user, "a.png"),
		urlPublica(user, "b.png"),
		urlPublica(user, "c.png"),
	))

	r, err := jobs.SweepOrphans(context.Background(), db, b.client(), jobs.OrphanGrace)
	require.NoError(t, err)
	require.Equal(t, 0, r.Deleted)
	require.Empty(t, b.deleted)
}

// An empty/corrupted workspace must not turn into "delete everything".
func TestSweepWithEmptyWorkspaceDeletesNothing(t *testing.T) {
	db := newDB(t)
	old := time.Now().Add(-100 * time.Hour)
	b := newFakeBucket(map[string]objetoFalso{
		key(user, "a.png"): {size: 1, modified: old},
	})
	defer b.servidor.Close()

	// null data: the user never saved. With no known reference, the safe thing is
	// not to delete — the image may be in a save that has not arrived yet.
	inserirWorkspace(t, db, user, nil)

	r, err := jobs.SweepOrphans(context.Background(), db, b.client(), jobs.OrphanGrace)
	require.NoError(t, err)
	require.Equal(t, 1, r.Deleted, "with no reference, an old orphan is still an orphan")
	require.False(t, b.exists(key(user, "a.png")))
}

func TestSweepWithoutConfiguredBucket(t *testing.T) {
	db := newDB(t)
	_, err := jobs.SweepOrphans(context.Background(), db, storage.New(storage.Config{}), time.Hour)
	require.ErrorIs(t, err, storage.ErrNotConfigured)
}

func TestSweepIgnoresExternalURL(t *testing.T) {
	db := newDB(t)
	old := time.Now().Add(-100 * time.Hour)
	b := newFakeBucket(map[string]objetoFalso{
		key(user, "minha.png"): {size: 1, modified: old},
	})
	defer b.servidor.Close()

	// An image outside the bucket (pasted by the user) neither protects nor affects.
	inserirWorkspace(t, db, user, workspaceComImagens("https://site-externo.com/foto.png"))

	r, err := jobs.SweepOrphans(context.Background(), db, b.client(), jobs.OrphanGrace)
	require.NoError(t, err)
	require.Equal(t, 1, r.Deleted)
}

func TestStartSweepDisabledWithoutBucket(t *testing.T) {
	db := newDB(t)
	stop := jobs.StartOrphanSweep(db, storage.New(storage.Config{}), time.Hour)
	require.NotNil(t, stop)
	stop() // must not panic
}
