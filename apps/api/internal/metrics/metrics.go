// Package metrics exposes basic HTTP metrics in the Prometheus exposition
// format, WITHOUT depending on external libraries (keeps the starter lean).
//
// Collects:
//   - http_requests_total{method,status}      (counter)
//   - http_request_duration_seconds{method,route} (histogram, fixed buckets)
//   - http_requests_in_flight                 (gauge)
//
// Usage (in setupMiddleware):
//
//	mc := metrics.New()
//	app.Use(mc.Middleware())
//	app.Get("/metrics", mc.Handler())
package metrics

import (
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

// buckets are the boundaries (in seconds) of the latency histogram. They cover
// 5ms to 10s — the typical range of a web API.
var buckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

type histogram struct {
	counts []uint64 // count per bucket (same index as `buckets`)
	sum    float64
	count  uint64
}

// Collector accumulates the metrics in memory, protected by a mutex.
type Collector struct {
	mu        sync.Mutex
	reqTotal  map[string]uint64     // key: "method\x00status"
	durations map[string]*histogram // key: "method\x00route"
	inFlight  int64
}

// New creates an empty collector.
func New() *Collector {
	return &Collector{
		reqTotal:  make(map[string]uint64),
		durations: make(map[string]*histogram),
	}
}

// Middleware measures each request: increments in-flight, measures the duration
// and records the total by method+status. It skips the /metrics route itself.
func (col *Collector) Middleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		if c.Path() == "/metrics" {
			return c.Next()
		}
		start := time.Now()
		col.addInFlight(1)
		err := c.Next()
		col.addInFlight(-1)

		status := c.Response().StatusCode()
		// On error, the global ErrorHandler runs afterwards; we capture the code here
		// from the error so we do not record everything as 200.
		if err != nil {
			if fe, ok := err.(*fiber.Error); ok {
				status = fe.Code
			} else {
				status = fiber.StatusInternalServerError
			}
		}

		route := c.Route().Path // registered pattern (low cardinality)
		col.observe(c.Method(), route, status, time.Since(start).Seconds())
		return err
	}
}

func (col *Collector) addInFlight(d int64) {
	col.mu.Lock()
	col.inFlight += d
	col.mu.Unlock()
}

func (col *Collector) observe(method, route string, status int, seconds float64) {
	col.mu.Lock()
	defer col.mu.Unlock()

	col.reqTotal[method+"\x00"+strconv.Itoa(status)]++

	key := method + "\x00" + route
	h := col.durations[key]
	if h == nil {
		h = &histogram{counts: make([]uint64, len(buckets))}
		col.durations[key] = h
	}
	h.sum += seconds
	h.count++
	for i, b := range buckets {
		if seconds <= b {
			h.counts[i]++
		}
	}
}

// Handler returns the endpoint that renders the metrics in Prometheus format.
//
// Security: in production, /metrics is NEVER left open. If METRICS_TOKEN is
// defined, it requires Authorization: Bearer <token>; if it is not, the endpoint
// is denied (fail-closed) — avoids leaking routes/traffic volume to the
// internet. In dev/test (ENV != production) it stays open to ease local scraping.
func (col *Collector) Handler() fiber.Handler {
	token := os.Getenv("METRICS_TOKEN")
	isProd := os.Getenv("ENV") == "production"
	return func(c *fiber.Ctx) error {
		if token == "" {
			if isProd {
				// Fail-closed: without a token in production, it does not expose metrics.
				return c.SendStatus(fiber.StatusNotFound)
			}
		} else if c.Get("Authorization") != "Bearer "+token {
			return c.SendStatus(fiber.StatusUnauthorized)
		}
		c.Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		return c.SendString(col.render())
	}
}

// render builds the text in the Prometheus exposition format. The keys are
// sorted to get deterministic output (eases tests and diffs).
func (col *Collector) render() string {
	col.mu.Lock()
	defer col.mu.Unlock()

	var b strings.Builder

	b.WriteString("# HELP http_requests_total Total HTTP requests by method and status.\n")
	b.WriteString("# TYPE http_requests_total counter\n")
	for _, k := range sortedKeys(col.reqTotal) {
		parts := strings.SplitN(k, "\x00", 2)
		b.WriteString("http_requests_total{method=\"")
		b.WriteString(escape(parts[0]))
		b.WriteString("\",status=\"")
		b.WriteString(parts[1])
		b.WriteString("\"} ")
		b.WriteString(strconv.FormatUint(col.reqTotal[k], 10))
		b.WriteByte('\n')
	}

	b.WriteString("# HELP http_request_duration_seconds HTTP request duration in seconds.\n")
	b.WriteString("# TYPE http_request_duration_seconds histogram\n")
	durKeys := make([]string, 0, len(col.durations))
	for k := range col.durations {
		durKeys = append(durKeys, k)
	}
	sort.Strings(durKeys)
	for _, k := range durKeys {
		parts := strings.SplitN(k, "\x00", 2)
		method, route := escape(parts[0]), escape(parts[1])
		h := col.durations[k]
		var cumulative uint64
		for i, bound := range buckets {
			cumulative += h.counts[i]
			b.WriteString("http_request_duration_seconds_bucket{method=\"")
			b.WriteString(method)
			b.WriteString("\",route=\"")
			b.WriteString(route)
			b.WriteString("\",le=\"")
			b.WriteString(strconv.FormatFloat(bound, 'g', -1, 64))
			b.WriteString("\"} ")
			b.WriteString(strconv.FormatUint(cumulative, 10))
			b.WriteByte('\n')
		}
		// bucket +Inf = total observations.
		b.WriteString("http_request_duration_seconds_bucket{method=\"")
		b.WriteString(method)
		b.WriteString("\",route=\"")
		b.WriteString(route)
		b.WriteString("\",le=\"+Inf\"} ")
		b.WriteString(strconv.FormatUint(h.count, 10))
		b.WriteByte('\n')

		b.WriteString("http_request_duration_seconds_sum{method=\"")
		b.WriteString(method)
		b.WriteString("\",route=\"")
		b.WriteString(route)
		b.WriteString("\"} ")
		b.WriteString(strconv.FormatFloat(h.sum, 'g', -1, 64))
		b.WriteByte('\n')

		b.WriteString("http_request_duration_seconds_count{method=\"")
		b.WriteString(method)
		b.WriteString("\",route=\"")
		b.WriteString(route)
		b.WriteString("\"} ")
		b.WriteString(strconv.FormatUint(h.count, 10))
		b.WriteByte('\n')
	}

	b.WriteString("# HELP http_requests_in_flight HTTP requests currently in flight.\n")
	b.WriteString("# TYPE http_requests_in_flight gauge\n")
	b.WriteString("http_requests_in_flight ")
	b.WriteString(strconv.FormatInt(col.inFlight, 10))
	b.WriteByte('\n')

	return b.String()
}

func sortedKeys(m map[string]uint64) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// escape handles the special characters of a Prometheus label value.
func escape(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	return s
}
