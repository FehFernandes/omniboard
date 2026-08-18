package server_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

// resp is an HTTP response already decoded to make assertions easier.
type resp struct {
	status int
	body   map[string]any
	// raw is the raw body. It exists to assert the ABSENCE of data: on a public
	// route, what matters is that certain text appears nowhere in the response —
	// checking field by field would leave gaps.
	raw string
}

// do sends a request to the real app and returns status plus decoded body.
func do(t *testing.T, method, path, token string, payload any) resp {
	t.Helper()
	var reader io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, path, reader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	// High timeout: these operations hit the real Postgres.
	res, err := app.Test(req, 10000)
	if err != nil {
		t.Fatalf("app.Test: %v", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return resp{status: res.StatusCode, body: out, raw: string(raw)}
}

// str extrai uma string aninhada do body: str(r.body, "user", "role").
func str(m map[string]any, keys ...string) string {
	cur := any(m)
	for _, k := range keys {
		mm, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur = mm[k]
	}
	s, _ := cur.(string)
	return s
}

// num extracts a nested number (JSON float64).
func num(m map[string]any, keys ...string) float64 {
	cur := any(m)
	for _, k := range keys {
		mm, ok := cur.(map[string]any)
		if !ok {
			return 0
		}
		cur = mm[k]
	}
	f, _ := cur.(float64)
	return f
}
