package studio

// Regression contract for the structural failures reproduced by the audit.
// Also runs in the normal suite; make web-llm-reliability-audit isolates it; no paid API is contacted.
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

	"github.com/jackc/pgx/v5"
	"tarjama/web/internal/research"
)

type auditReferenceTools struct{ calls int }

func (a *auditReferenceTools) Tools() []any {
	return []any{map[string]any{"type": "function", "function": map[string]any{"name": "quran_fr", "parameters": map[string]any{"type": "object"}}}}
}
func (a *auditReferenceTools) Call(string, json.RawMessage) (any, error) {
	a.calls++
	return map[string]any{"status": "found", "entries": []string{"fixture"}}, nil
}
func auditToolResponse(w http.ResponseWriter, count int) {
	calls := []any{}
	for i := 0; i < count; i++ {
		calls = append(calls, map[string]any{"id": fmt.Sprintf("call-%d", i), "type": "function", "function": map[string]string{"name": "quran_fr", "arguments": fmt.Sprintf(`{"surah":2,"verse":%d}`, i+1)}})
	}
	json.NewEncoder(w).Encode(map[string]any{"id": "audit-request", "choices": []any{map[string]any{"finish_reason": "tool_calls", "message": map[string]any{"role": "assistant", "tool_calls": calls}}}, "usage": map[string]any{"cost": 0.001, "server_tool_use": map[string]int{"web_search_requests": 0}}})
}
func auditQueued(t *testing.T) (*Store, string, Project) {
	t.Helper()
	s := testStore(t)
	owner, p := fixture(t, s)
	_, err := s.Mutate(context.Background(), owner, p.ID, func(q *Project, tx pgx.Tx) error {
		q.Stage = "translating"
		return enqueue(context.Background(), tx, owner, *q, "translate")
	})
	if err != nil {
		t.Fatal(err)
	}
	return s, owner, p
}
func auditDue(t *testing.T, s *Store, clearCooldown bool) {
	t.Helper()
	_, err := s.DB.Exec(context.Background(), "UPDATE jobs SET next_attempt_at=now()")
	if err != nil {
		t.Fatal(err)
	}
	if clearCooldown {
		if _, err = s.DB.Exec(context.Background(), "UPDATE cooldowns SET until_at=now()"); err != nil {
			t.Fatal(err)
		}
	}
}

func TestReliabilityAudit(t *testing.T) {
	t.Run("local_tool_limits_reserve_a_final_answer", func(t *testing.T) {
		for _, batch := range []int{1, 9} {
			t.Run(fmt.Sprint(batch), func(t *testing.T) {
				s, owner, p := auditQueued(t)
				local := &auditReferenceTools{}
				requests := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					requests++
					var body map[string]any
					json.NewDecoder(r.Body).Decode(&body)
					if body["tool_choice"] == "none" {
						if _, ok := body["max_tool_calls"]; ok {
							t.Error("finalization renewed server budget")
						}
						for _, tool := range body["tools"].([]any) {
							if tool.(map[string]any)["type"] != "function" {
								t.Error("finalization still exposes server tools")
							}
						}
						if batch == 9 {
							messages := body["messages"].([]any)
							if len(messages) != 12 {
								t.Error("missing tool replies", len(messages))
							} else {
								last := messages[11].(map[string]any)["content"].(string)
								if !strings.Contains(last, "budget_exhausted") {
									t.Error("unexecuted lookup fabricated a result", last)
								}
							}
						}
						fmt.Fprint(w, `{"choices":[{"finish_reason":"stop","message":{"content":"{\"segments\":[{\"id\":\"one\",\"text\":\"Bonjour\"},{\"id\":\"two\",\"text\":\"Merci\"}]}"}}]}`)
						return
					}
					auditToolResponse(w, batch)
				}))
				defer server.Close()
				provider := NewProviders()
				provider.TextURL = server.URL
				provider.References = local
				worker := Worker{Store: s, Config: Config{OpenRouterKey: "fixture"}, Providers: provider}
				if _, err := worker.Once(context.Background()); err != nil {
					t.Fatal(err)
				}
				jobs, err := s.Jobs(context.Background(), owner, p.ID)
				if err != nil {
					t.Fatal(err)
				}
				wantRequests, wantLocal := 6, 5
				if batch == 9 {
					wantRequests, wantLocal = 2, 8
				}
				if len(jobs) != 1 || jobs[0].State != "queued" || requests != wantRequests || local.calls != wantLocal {
					t.Fatal(jobs, requests, local.calls)
				}
				t.Logf("batch=%d HTTP=%d local_executed=%d; validated chunk saved after final-answer turn", batch, requests, local.calls)
			})
		}
	})
	t.Run("cooldown_waits_preserve_malformed_response_retry_allowance", func(t *testing.T) {
		s, owner, p := auditQueued(t)
		provider := &scriptedProvider{failure: errors.New("Réponse IA incomplète")}
		worker := Worker{Store: s, Config: Config{OpenRouterKey: "fixture"}, Providers: provider}
		if err := s.SetCooldown(context.Background(), "openrouter:shared", time.Hour); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < 2; i++ {
			auditDue(t, s, false)
			if _, err := worker.Once(context.Background()); err != nil {
				t.Fatal(err)
			}
		}
		if provider.calls != 0 {
			t.Fatal("cooldown contacted model")
		}
		auditDue(t, s, true)
		if _, err := worker.Once(context.Background()); err != nil {
			t.Fatal(err)
		}
		jobs, err := s.Jobs(context.Background(), owner, p.ID)
		if err != nil {
			t.Fatal(err)
		}
		if jobs[0].State != "waiting_provider" || provider.calls != 1 {
			t.Fatal(jobs, provider.calls)
		}
		t.Log("2 passive cooldown waits + first malformed answer => automatic retry remains available")
	})
	t.Run("failed_attempt_retains_usage_and_reference_audit", func(t *testing.T) {
		local := &auditReferenceTools{}
		requests := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requests++
			if requests%2 == 1 {
				auditToolResponse(w, 1)
			} else {
				w.WriteHeader(502)
			}
		}))
		defer server.Close()
		runner := research.Runner{Client: server.Client(), Endpoint: server.URL, Model: TextModel, LocalTools: local}
		out, err := runner.Run(context.Background(), "fixture", "", nil, nil)
		if err == nil || len(out.Audit.Local) != 1 || len(out.Audit.ModelUsage) != 1 {
			t.Fatal(out, err)
		}
		provider := NewProviders()
		provider.TextURL = server.URL
		provider.References = local
		result, err := provider.Text(context.Background(), "fixture", "translate", []Segment{{ID: "one", Arabic: "سلام"}}, nil)
		if err == nil || len(result.Grounding) == 0 {
			t.Fatal(result, err)
		}
		t.Log("runner retains 1 reference and 1 usage; provider adapter preserves audit on failure")
	})
	t.Run("documented_usage_shape_preserves_remaining_web_budget", func(t *testing.T) {
		local := &auditReferenceTools{}
		requests := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requests++
			if requests == 1 {
				auditToolResponse(w, 1)
				return
			}
			var body map[string]any
			if json.NewDecoder(r.Body).Decode(&body) != nil {
				t.Error("invalid request")
				return
			}
			if body["max_tool_calls"] != float64(4) || len(body["tools"].([]any)) != 3 {
				t.Error("remaining web budget lost", body["max_tool_calls"])
			}
			fmt.Fprint(w, `{"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]}`)
		}))
		defer server.Close()
		runner := research.Runner{Client: server.Client(), Endpoint: server.URL, Model: TextModel, LocalTools: local}
		if _, err := runner.Run(context.Background(), "fixture", "", nil, nil); err != nil {
			t.Fatal(err)
		}
		t.Log("partial usage keeps a bounded web continuation without refunding uncertain spend")
	})
	t.Run("transport_timeouts_stop_at_total_attempt_cap", func(t *testing.T) {
		s, owner, p := auditQueued(t)
		requests := 0
		provider := NewProviders()
		provider.Client = &http.Client{Transport: auditTimeoutTransport{calls: &requests}}
		worker := Worker{Store: s, Config: Config{OpenRouterKey: "fixture"}, Providers: provider}
		for i := 0; i < 6; i++ {
			auditDue(t, s, true)
			if _, err := worker.Once(context.Background()); err != nil && !errors.Is(err, pgx.ErrNoRows) {
				t.Fatal(err)
			}
		}
		jobs, err := s.Jobs(context.Background(), owner, p.ID)
		if err != nil {
			t.Fatal(err)
		}
		if jobs[0].State != "failed" || requests != 4 {
			t.Fatal(jobs, requests)
		}
		t.Log("4 transport timeouts => paused for explicit intervention; no fifth provider call")
	})
}

type auditTimeoutTransport struct{ calls *int }

func (a auditTimeoutTransport) RoundTrip(*http.Request) (*http.Response, error) {
	*a.calls++
	return nil, context.DeadlineExceeded
}
