package studio

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTranslationResearchAndProvenance(t *testing.T) {
	for _, forged := range []bool{false, true} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			tools, ok := body["tools"].([]any)
			if !ok || len(tools) != 2 {
				t.Error("research tools unavailable")
			}
			instruction, _ := json.Marshal(body["systemInstruction"])
			for _, rule := range []string{"Muhammad Hamidullah", "quran.com", "Sunnah.com", "Ne modernise"} {
				if rule == "Ne modernise" {
					rule = "ne modernise"
				}
				if !strings.Contains(string(instruction), rule) {
					t.Error("lost desktop rule", rule)
				}
			}
			content := `{"segments":[{"id":"a","text":"Bonjour"}]}`
			if forged {
				content = `{"segments":[{"id":"a","text":"Bonjour"}],"grounding":{"verified":true}}`
			}
			json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{
				"finishReason": "STOP", "content": map[string]any{"parts": []any{map[string]string{"text": content}}},
				"groundingMetadata": map[string]any{"webSearchQueries": []string{"site:quran.com test"}},
			}}})
		}))
		p := NewProviders()
		p.GeminiURL = server.URL
		result, err := p.Text(context.Background(), "fixture", "translate", []Segment{{ID: "a", Arabic: "سلام"}}, nil)
		server.Close()
		if forged {
			if err == nil {
				t.Fatal("model forged provenance")
			}
			continue
		}
		if err != nil || !strings.Contains(string(result.Grounding), "site:quran.com") {
			t.Fatal("provider provenance lost", err)
		}
	}
}
