package storage

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Maintenance operations on the bucket: list and delete.
//
// They exist for the orphan sweep: an image removed from the board keeps taking
// up space, and without this the bucket only grows. The signature is the same
// SigV4 as the upload — what changes is the method and the query.

/** Bucket object, as far as the sweep cares. */
type Object struct {
	Key      string
	Size     int64
	Modified time.Time
}

// XML response of ListObjectsV2 (only the fields used).
type listBucketResult struct {
	IsTruncated           bool   `xml:"IsTruncated"`
	NextContinuationToken string `xml:"NextContinuationToken"`
	Contents              []struct {
		Key          string    `xml:"Key"`
		Size         int64     `xml:"Size"`
		LastModified time.Time `xml:"LastModified"`
	} `xml:"Contents"`
}

// httpClient is injectable for tests; the default has a timeout (never use the
// zero value of http.Client on an external call: it waits forever).
var httpClient = &http.Client{Timeout: 30 * time.Second}

// ListPrefix returns all objects under a prefix, paginating to the end.
//
// `max` caps the total returned (0 = no limit) so the sweep does not load an
// entire giant bucket into memory at once.
func (cl *Client) ListPrefix(ctx context.Context, prefix string, max int) ([]Object, error) {
	if !cl.cfg.Enabled() {
		return nil, ErrNotConfigured
	}
	u, err := url.Parse(cl.cfg.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("storage: invalid endpoint: %w", err)
	}

	var out []Object
	continuacao := ""
	for {
		q := url.Values{}
		q.Set("list-type", "2")
		if prefix != "" {
			q.Set("prefix", prefix)
		}
		if continuacao != "" {
			q.Set("continuation-token", continuacao)
		}

		assinada := cl.presignComQuery(
			http.MethodGet,
			u.Scheme,
			u.Host,
			"/"+encodePath(cl.cfg.Bucket),
			q,
			[][2]string{{"host", u.Host}},
			cl.now().UTC(),
		)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, assinada, nil)
		if err != nil {
			return nil, err
		}
		res, err := httpClient.Do(req)
		if err != nil {
			return nil, err
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return nil, fmt.Errorf("storage: list %d: %s", res.StatusCode, truncate(string(body), 200))
		}

		var parsed listBucketResult
		if err := xml.Unmarshal(body, &parsed); err != nil {
			return nil, fmt.Errorf("storage: invalid list response: %w", err)
		}
		for _, c := range parsed.Contents {
			out = append(out, Object{Key: c.Key, Size: c.Size, Modified: c.LastModified})
			if max > 0 && len(out) >= max {
				return out, nil
			}
		}
		if !parsed.IsTruncated || parsed.NextContinuationToken == "" {
			return out, nil
		}
		continuacao = parsed.NextContinuationToken
	}
}

// Delete removes an object. Idempotent: deleting what does not exist returns 204.
func (cl *Client) Delete(ctx context.Context, key string) error {
	if !cl.cfg.Enabled() {
		return ErrNotConfigured
	}
	u, err := url.Parse(cl.cfg.Endpoint)
	if err != nil {
		return fmt.Errorf("storage: invalid endpoint: %w", err)
	}
	assinada := cl.presign(
		http.MethodDelete,
		u.Scheme,
		u.Host,
		"/"+encodePath(cl.cfg.Bucket)+"/"+encodePath(key),
		[][2]string{{"host", u.Host}},
		cl.now().UTC(),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, assinada, nil)
	if err != nil {
		return err
	}
	res, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(res.Body)
		return fmt.Errorf("storage: delete %d: %s", res.StatusCode, truncate(string(body), 200))
	}
	return nil
}

// KeyDaURL extracts the object key from a public URL of this bucket.
//
// Returns "" when the URL is not from the bucket (an external image pasted by
// the user, for example) — in those cases there is nothing of ours to sweep.
func (cl *Client) KeyDaURL(bruta string) string {
	base := strings.TrimRight(cl.cfg.PublicBaseURL, "/")
	if base == "" || !strings.HasPrefix(bruta, base+"/") {
		return ""
	}
	key := strings.TrimPrefix(bruta, base+"/")
	// Query/fragment are not part of the key.
	if i := strings.IndexAny(key, "?#"); i >= 0 {
		key = key[:i]
	}
	if decodificada, err := url.PathUnescape(key); err == nil {
		key = decodificada
	}
	return key
}

/** Prefix of a user's objects (see PresignImage). */
func UserPrefix(userID string) string {
	return "u/" + sanitizeSegment(userID) + "/"
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
