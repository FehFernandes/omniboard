package metrics

import (
	"strings"
	"testing"
)

func TestObserveAndRender(t *testing.T) {
	col := New()
	col.observe("GET", "/api/items", 200, 0.003) // falls in the first bucket (<=0.005)
	col.observe("GET", "/api/items", 200, 0.2)   // <=0.25
	col.observe("POST", "/api/items", 201, 0.4)  // <=0.5

	out := col.render()

	if !strings.Contains(out, `http_requests_total{method="GET",status="200"} 2`) {
		t.Errorf("counter GET/200 ausente ou incorreto:\n%s", out)
	}
	if !strings.Contains(out, `http_requests_total{method="POST",status="201"} 1`) {
		t.Errorf("counter POST/201 ausente ou incorreto:\n%s", out)
	}
	if !strings.Contains(out, `http_request_duration_seconds_bucket{method="GET",route="/api/items",le="+Inf"} 2`) {
		t.Errorf("bucket +Inf incorreto:\n%s", out)
	}
	if !strings.Contains(out, `http_request_duration_seconds_bucket{method="GET",route="/api/items",le="0.005"} 1`) {
		t.Errorf("bucket 0.005 cumulativo incorreto:\n%s", out)
	}
	if !strings.Contains(out, `http_request_duration_seconds_count{method="GET",route="/api/items"} 2`) {
		t.Errorf("count incorreto:\n%s", out)
	}
	for _, want := range []string{
		"# TYPE http_requests_total counter",
		"# TYPE http_request_duration_seconds histogram",
		"# TYPE http_requests_in_flight gauge",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing header: %q", want)
		}
	}
}

func TestInFlightGauge(t *testing.T) {
	col := New()
	col.addInFlight(3)
	col.addInFlight(-1)
	if !strings.Contains(col.render(), "http_requests_in_flight 2") {
		t.Errorf("gauge in-flight incorreto:\n%s", col.render())
	}
}

func TestEscape(t *testing.T) {
	if got := escape(`a"b\c`); got != `a\"b\\c` {
		t.Errorf("escape incorreto: %q", got)
	}
}
