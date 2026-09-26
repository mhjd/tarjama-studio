//go:build reliability_audit

package studio

// Characterization of the deployed behavior, not the desired regression contract.
// Run explicitly with make web-llm-reliability-audit; no paid API is contacted.
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
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
		calls = append(calls, map[string]any{"id": fmt.Sprintf("call-%d", i), "type": "function", "function": map[string]string{"name": "quran_fr", "arguments": fmt.Sprintf(`{"surah":1,"verse":%d}`, i+1)}})
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
	t.Run("local_tool_limits_become_unclassified_terminal_failures", func(t *testing.T) {
		for _, batch := range []int{1, 9} {
			t.Run(fmt.Sprint(batch), func(t *testing.T) {
				s, owner, p := auditQueued(t)
				local := &auditReferenceTools{}
				requests := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++; auditToolResponse(w, batch) }))
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
				wantRequests, wantLocal := 5, 4
				if batch == 9 {
					wantRequests, wantLocal = 1, 0
				}
				if len(jobs) != 1 || jobs[0].State != "failed" || requests != wantRequests || local.calls != wantLocal {
					t.Fatal(jobs, requests, local.calls)
				}
				if jobFailureReason(errors.New("Limite ou protocole des outils locaux invalide")) != "unclassified" {
					t.Fatal("classification changed")
				}
				t.Logf("batch=%d HTTP=%d local_executed=%d state=failed reason=unclassified; no final-answer turn", batch, requests, local.calls)
			})
		}
	})
	t.Run("cooldown_waits_consume_malformed_response_retry_allowance", func(t *testing.T) {
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
		if jobs[0].State != "failed" || provider.calls != 1 {
			t.Fatal(jobs, provider.calls)
		}
		t.Log("2 passive cooldown waits + first malformed answer => failed after only 1 provider call")
	})
	t.Run("failed_attempt_loses_usage_and_reference_audit", func(t *testing.T) {
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
		if err == nil || len(result.Grounding) != 0 {
			t.Fatal(result, err)
		}
		t.Log("runner retains 1 reference and 1 usage; provider adapter returns empty audit on failure")
	})
	t.Run("documented_usage_shape_disables_web_after_first_local_call", func(t *testing.T) {
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
			for _, tool := range body["tools"].([]any) {
				if tool.(map[string]any)["type"] != "function" {
					t.Error("web still available; behavior changed")
				}
			}
			fmt.Fprint(w, `{"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]}`)
		}))
		defer server.Close()
		runner := research.Runner{Client: server.Client(), Endpoint: server.URL, Model: TextModel, LocalTools: local}
		if _, err := runner.Run(context.Background(), "fixture", "", nil, nil); err != nil {
			t.Fatal(err)
		}
		t.Log("server_tool_use.web_search_requests=0 but absent tool_calls_executed => web tools withdrawn on continuation (conservative budget policy)")
	})
	t.Run("transport_timeouts_have_no_total_attempt_cap", func(t *testing.T) {
		s, owner, p := auditQueued(t)
		requests := 0
		provider := NewProviders()
		provider.Client = &http.Client{Transport: auditTimeoutTransport{calls: &requests}}
		worker := Worker{Store: s, Config: Config{OpenRouterKey: "fixture"}, Providers: provider}
		for i := 0; i < 6; i++ {
			auditDue(t, s, true)
			if _, err := worker.Once(context.Background()); err != nil {
				t.Fatal(err)
			}
		}
		jobs, err := s.Jobs(context.Background(), owner, p.ID)
		if err != nil {
			t.Fatal(err)
		}
		if jobs[0].State != "waiting_provider" || requests != 6 {
			t.Fatal(jobs, requests)
		}
		t.Log("6 transport timeouts => still waiting_provider; code caps backoff but not attempts/cumulative spend")
	})
}

type auditTimeoutTransport struct{ calls *int }

func (a auditTimeoutTransport) RoundTrip(*http.Request) (*http.Response, error) {
	*a.calls++
	return nil, context.DeadlineExceeded
}
