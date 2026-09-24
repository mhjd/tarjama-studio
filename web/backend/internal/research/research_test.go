package research

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOpenRouterServerToolsSingleCredential(t *testing.T) {
	for _, model := range []string{"deepseek/deepseek-v4.1-flash", "future/model-with-native-search"} {
		t.Run(model, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Header.Get("Authorization") != "Bearer openrouter-fixture" {
					t.Error("wrong credential")
				}
				var body map[string]any
				if json.NewDecoder(r.Body).Decode(&body) != nil {
					t.Fatal("body")
				}
				if body["model"] != model || body["max_tool_calls"] != float64(16) || body["max_tokens"] != float64(32768) {
					t.Error("limits/model", body)
				}
				messages := body["messages"].([]any)
				if !strings.Contains(messages[0].(map[string]any)["content"].(string), `{"type":"object"}`) {
					t.Error("schema missing from server-tool continuation instructions")
				}
				if body["plugins"] != nil {
					t.Error("unexpected legacy plugin")
				}
				tools := body["tools"].([]any)
				if len(tools) != 2 {
					t.Fatal("tool count")
				}
				for i, kind := range []string{"openrouter:web_search", "openrouter:web_fetch"} {
					tool := tools[i].(map[string]any)
					p := tool["parameters"].(map[string]any)
					if tool["type"] != kind || p["engine"] != "parallel" {
						t.Error("engine fallback", tool)
					}
					if i == 0 && (p["max_results"] != float64(20) || p["max_uses"] != float64(6) || p["max_total_results"] != float64(120)) {
						t.Error("search limits")
					}
					if i == 1 && (p["max_uses"] != float64(10) || p["max_content_tokens"] != float64(12000)) {
						t.Error("fetch limits")
					}
				}
				fmt.Fprint(w, `{"id":"provider-id","choices":[{"finish_reason":"stop","message":{"content":"{}","annotations":[{"type":"url_citation"}]}}],"usage":{"server_tool_use_details":{"web_search_requests":1,"tool_calls_executed":2}}}`)
			}))
			defer server.Close()
			runner := Runner{Client: server.Client(), Endpoint: server.URL, Model: model}
			out, e := runner.Run(context.Background(), "openrouter-fixture", "prompt", map[string]string{}, map[string]string{"type": "object"})
			if e != nil || calls != 1 || out.Audit.ModelCalls != 1 || out.Audit.RequestID != "provider-id" || !strings.Contains(string(out.Audit.ModelUsage[0]), "web_search_requests") || len(out.Audit.Annotations) == 0 {
				t.Fatal(out, e, calls)
			}
		})
	}
}
func TestErrorsDoNotLeakOrRetry(t *testing.T) {
	for _, status := range []int{400, 401, 403, 429, 502} {
		calls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			w.Header().Set("Retry-After", "42")
			w.WriteHeader(status)
			fmt.Fprint(w, "private upstream diagnostics")
		}))
		runner := Runner{Client: server.Client(), Endpoint: server.URL, Model: "allowed"}
		_, e := runner.Run(context.Background(), "fixture", "", nil, nil)
		server.Close()
		var typed *ModelHTTPError
		if !errors.As(e, &typed) || typed.Status != status || typed.RetryAfter != "42" || strings.Contains(e.Error(), "private") || calls != 1 {
			t.Fatal(e, calls)
		}
	}
}
func TestMissingKeyAndRetiredModelNeverCall(t *testing.T) {
	for _, r := range []Runner{{Model: "google/gemini-3.5-flash-lite"}, {Model: "allowed"}} {
		if _, e := r.Run(context.Background(), "", "", nil, nil); e == nil {
			t.Fatal("invalid configuration accepted")
		}
	}
}
func TestServerToolsFailClosed(t *testing.T) {
	for _, response := range []string{
		`{"choices":[{"finish_reason":"tool_calls","message":{"tool_calls":[{"function":{"name":"web_fetch"}}]}}]}`,
		`{"choices":[{"finish_reason":"stop","message":{"content":"{}","tool_calls":[{}]}}]}`,
		`{"choices":[{"finish_reason":"stop","message":{"content":""}}]}`,
		`{"choices":[{"finish_reason":"length"}]}`,
		`{"error":{"message":"private detail"}}`,
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, response) }))
		runner := Runner{Client: server.Client(), Endpoint: server.URL, Model: "allowed"}
		out, e := runner.Run(context.Background(), "fixture", "", nil, nil)
		server.Close()
		if e == nil || out.Text != "" {
			t.Fatal("invalid completion accepted", out, e)
		}
		if strings.Contains(response, "length") && !errors.Is(e, ErrTruncated) {
			t.Fatal(e)
		}
	}
}
func TestCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(100 * time.Millisecond) }))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	runner := Runner{Client: server.Client(), Endpoint: server.URL, Model: "allowed"}
	_, e := runner.Run(ctx, "fixture", "", nil, nil)
	var connection *ConnectionError
	if !errors.As(e, &connection) {
		t.Fatal(e)
	}
}

func TestHTTP200ProviderErrorDoesNotBecomeCompletion(t *testing.T) {
	for _, code := range []string{"429", "502", "401", "402", `"503"`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Retry-After", "37")
			fmt.Fprintf(w, `{"error":{"code":%s,"message":"private upstream detail"},"choices":[{"finish_reason":"stop","message":{"content":"do not accept"}}]}`, code)
		}))
		runner := Runner{Client: server.Client(), Endpoint: server.URL, Model: "allowed"}
		out, err := runner.Run(context.Background(), "fixture", "", nil, nil)
		server.Close()
		var failure *ModelHTTPError
		if !errors.As(err, &failure) || failure.RetryAfter != "37" || out.Text != "" || strings.Contains(err.Error(), "private") {
			t.Fatalf("code=%s err=%v", code, err)
		}
	}
}
func TestHTTP200UnknownErrorRemainsExplicit(t *testing.T) {
	for _, body := range []string{`{"error":{"message":"private detail"}}`, `{"error":{"code":"unexpected","message":"private detail"}}`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
		runner := Runner{Client: server.Client(), Endpoint: server.URL, Model: "allowed"}
		out, err := runner.Run(context.Background(), "fixture", "", nil, nil)
		server.Close()
		if err == nil || err.Error() != "Erreur OpenRouter sans statut" || out.Text != "" {
			t.Fatal(out, err)
		}
	}
}
