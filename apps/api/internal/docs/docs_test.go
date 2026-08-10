package docs

import (
	"testing"

	"gopkg.in/yaml.v3"
)

// TestSpecIsValidYAML ensures the embedded openapi.yaml is valid YAML and has the
// top-level fields expected of an OpenAPI 3 document.
func TestSpecIsValidYAML(t *testing.T) {
	if len(spec) == 0 {
		t.Fatal("the embedded spec is empty")
	}
	var doc map[string]any
	if err := yaml.Unmarshal(spec, &doc); err != nil {
		t.Fatalf("invalid openapi.yaml: %v", err)
	}
	for _, key := range []string{"openapi", "info", "paths"} {
		if _, ok := doc[key]; !ok {
			t.Errorf("openapi.yaml is missing the top-level key %q", key)
		}
	}
	paths, _ := doc["paths"].(map[string]any)
	if len(paths) == 0 {
		t.Error("openapi.yaml sem paths")
	}
}
