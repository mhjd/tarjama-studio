package research

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSameToolsAcrossModels(t *testing.T) {
	for _, modelID := range []string{"deepseek/deepseek-v4.1-flash", "synthetic/other-tool-model"} {
		t.Run(modelID, func(t *testing.T) {
			webCalls := 0
			web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				webCalls++
				if r.Header.Get("x-api-key") != "parallel-test" || r.Header.Get("Authorization") != "" {
					t.Error("credential routing")
				}
				var b map[string]any
				json.NewDecoder(r.Body).Decode(&b)
				if webCalls == 1 {
					if r.URL.Path != "/v1/search" {
						t.Error(r.URL.Path)
					}
					advanced := b["advanced_settings"].(map[string]any)
					if advanced["max_results"] != float64(20) {
						t.Error("not 20 results")
					}
					fmt.Fprint(w, `{"search_id":"search-1","session_id":"session-1","results":[{"url":"https://example.com/term","title":"Nom vérifié","excerpts":["La graphie est TestName."]}],"usage":[{"name":"search","count":1}]}`)
				} else {
					if r.URL.Path != "/v1/extract" || b["session_id"] != "session-1" {
						t.Error("fetch/session missing", b)
					}
					fmt.Fprint(w, `{"extract_id":"extract-1","session_id":"session-1","results":[{"url":"https://example.com/term","title":"Original","excerpts":["Nom complet : TestName."]}]}`)
				}
			}))
			defer web.Close()
			calls := 0
			model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var b map[string]any
				json.NewDecoder(r.Body).Decode(&b)
				encoded, _ := json.Marshal(b)
				for _, native := range []string{"google_search", "url_context", "web_search_preview", "\"plugins\""} {
					if strings.Contains(string(encoded), native) {
						t.Error("native search leaked", native)
					}
				}
				if r.Header.Get("Authorization") != "Bearer model-test" {
					t.Error("model key missing")
				}
				if calls == 1 {
					fmt.Fprint(w, `{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":null,"reasoning_details":[{"signature":"opaque"}],"tool_calls":[{"id":"o1","type":"function","function":{"name":"web_search","arguments":"{\"objective\":\"Vérifier le nom\",\"queries\":[\"TestName\"]}"}}]}}],"usage":{"total_tokens":20}}`)
				} else if calls == 2 {
					if !strings.Contains(string(encoded), "\"tool_call_id\":\"o1\"") || !strings.Contains(string(encoded), "reasoning_details") {
						t.Error("lost tool result or reasoning")
					}
					fmt.Fprint(w, `{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":null,"tool_calls":[{"id":"o2","type":"function","function":{"name":"web_fetch","arguments":"{\"objective\":\"Vérifier le nom complet\",\"urls\":[\"https://example.com/term\"]}"}}]}}]}`)
				} else {
					fmt.Fprint(w, `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"{\"answer\":\"TestName\"}"}}]}`)
				}
			}))
			defer model.Close()
			p := NewParallel("parallel-test")
			p.URL = web.URL
			r := Runner{Parallel: p, Client: model.Client(), Endpoint: model.URL, Model: modelID}
			out, e := r.Run(context.Background(), "model-test", "Use search and fetch", map[string]string{"question": "name?"}, map[string]string{"type": "object"})
			if e != nil || out.Text != `{"answer":"TestName"}` || webCalls != 2 || calls != 3 || len(out.Audit.Calls) != 2 {
				t.Fatal(out, e, webCalls, calls)
			}
			audit, _ := json.Marshal(out.Audit)
			if strings.Contains(string(audit), "parallel-test") || strings.Contains(string(audit), "model-test") {
				t.Fatal("key leaked")
			}
		})
	}
}
func TestParallelRejectsUnsafeAndInvalidCalls(t *testing.T) {
	p := NewParallel("fixture")
	calls := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; t.Error("invalid call reached provider") }))
	defer s.Close()
	p.URL = s.URL
	for _, raw := range []string{`{"objective":"x","urls":["http://127.0.0.1/a"]}`, `{"objective":"x","urls":["https://user:password@example.com"]}`, `{"objective":"x","urls":["file:///etc/passwd"]}`, `{"objective":"x","urls":["https://localhost/a"]}`, `{"objective":"x","urls":["https://169.254.169.254/a"]}`, `{"objective":"x","urls":["https://example.com"],"shell":"id"}`, `{"objective":"x","urls":[]}`} {
		if _, e := p.Execute(context.Background(), "web_fetch", json.RawMessage(raw), ""); e == nil {
			t.Fatal("accepted", raw)
		}
	}
	if _, e := p.Execute(context.Background(), "shell", json.RawMessage(`{}`), ""); e == nil {
		t.Fatal("unknown tool")
	}
	if calls != 0 {
		t.Fatal(calls)
	}
}
func TestParallelErrorsDoNotLeakOrFallback(t *testing.T) {
	for _, status := range []int{302, 401, 429, 500} {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Location", "https://example.com")
			w.WriteHeader(status)
			fmt.Fprint(w, "sensitive-fixture")
		}))
		p := NewParallel("fixture")
		p.URL = s.URL
		_, e := p.Execute(context.Background(), "web_search", json.RawMessage(`{"objective":"test","queries":["test"]}`), "")
		s.Close()
		if e == nil || strings.Contains(e.Error(), "sensitive-fixture") {
			t.Fatal(status, e)
		}
	}
	p := NewParallel("")
	if _, e := p.Execute(context.Background(), "web_search", json.RawMessage(`{}`), ""); e == nil {
		t.Fatal("missing key accepted")
	}
}
func TestParallelBoundsAndPartialExtraction(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		results := []Source{}
		for i := 0; i < 25; i++ {
			results = append(results, Source{URL: fmt.Sprintf("https://example.com/%d", i), Title: "source", Excerpts: []string{strings.Repeat("ع", 3000), strings.Repeat("b", 3000)}})
		}
		json.NewEncoder(w).Encode(map[string]any{"extract_id": "fetch", "session_id": "s", "results": results, "errors": []any{map[string]string{"url": "https://example.com/failed", "content": "untrusted error ignored"}}})
	}))
	defer s.Close()
	p := NewParallel("fixture")
	p.URL = s.URL
	result, e := p.Execute(context.Background(), "web_fetch", json.RawMessage(`{"objective":"test","urls":["https://example.com/1"]}`), "")
	chars := 0
	for _, r := range result.Results {
		for _, s := range r.Excerpts {
			chars += len([]rune(s))
		}
	}
	if e != nil || len(result.Results) != 20 || chars > 24000 || len(result.FailedURLs) != 1 {
		t.Fatal(e, len(result.Results), chars, result.FailedURLs)
	}
}
func TestRunnerBudgetAndCancellation(t *testing.T) {
	webCalls := 0
	web := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		webCalls++
		fmt.Fprint(w, `{"search_id":"s","session_id":"x","results":[]}`)
	}))
	defer web.Close()
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","tool_calls":[{"id":"one","type":"function","function":{"name":"web_search","arguments":"{\"objective\":\"x\",\"queries\":[\"x\"]}"}}]}}]}`)
	}))
	defer model.Close()
	p := NewParallel("fixture")
	p.URL = web.URL
	r := Runner{Parallel: p, Client: model.Client(), Endpoint: model.URL}
	out, e := r.Run(context.Background(), "fixture", "prompt", nil, nil)
	if e == nil || webCalls != 6 || len(out.Audit.Calls) != 6 {
		t.Fatal("unbounded loop", e, webCalls)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = r.Run(ctx, "fixture", "prompt", nil, nil); e == nil || webCalls != 6 {
		t.Fatal("cancel ignored")
	}
}

func TestGeminiCannotBeSelected(t *testing.T) {
	r := Runner{Model: "google/gemini-3.5-flash-lite", Parallel: NewParallel("fixture")}
	if _, e := r.Run(context.Background(), "fixture", "prompt", nil, nil); e == nil || !strings.Contains(e.Error(), "retiré") {
		t.Fatal("retired model accepted", e)
	}
}
