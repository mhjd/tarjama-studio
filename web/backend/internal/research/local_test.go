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
)

type fixtureTools struct{ calls int }

func (f *fixtureTools) Tools() []any {
	return []any{map[string]any{"type": "function", "function": map[string]any{"name": "quran_fr"}}}
}
func (f *fixtureTools) Call(n string, a json.RawMessage) (any, error) {
	f.calls++
	if !json.Valid(a) {
		return nil, errors.New("invalid query")
	}
	return map[string]any{"status": "found", "version": "fixture", "entries": []string{"Arabic/French fixture"}}, nil
}

func TestMalformedLocalArgumentsCanBeCorrectedWithoutResettingWebBudget(t *testing.T) {
	local := &fixtureTools{}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			fmt.Fprint(w, `{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","tool_calls":[{"id":"bad","type":"function","function":{"name":"quran_fr","arguments":"{bad"}}]}}]}`)
			return
		}
		var payload map[string]any
		json.NewDecoder(r.Body).Decode(&payload)
		if _, exists := payload["max_tool_calls"]; exists {
			t.Error("missing usage counter granted a new web budget")
		}
		for _, tool := range payload["tools"].([]any) {
			if tool.(map[string]any)["type"] != "function" {
				t.Error("web tool still available without known remaining budget")
			}
		}
		messages := payload["messages"].([]any)
		if !strings.Contains(messages[3].(map[string]any)["content"].(string), "invalid_query") {
			t.Error("validation error not returned to model")
		}
		fmt.Fprint(w, `{"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]}`)
	}))
	defer server.Close()
	r := Runner{Client: server.Client(), Endpoint: server.URL, Model: "allowed", LocalTools: local}
	out, err := r.Run(context.Background(), "fixture", "", nil, nil)
	if err != nil || calls != 2 || local.calls != 1 {
		t.Fatal(err, calls, local.calls)
	}
	encoded, err := json.Marshal(out.Audit)
	if err != nil || !strings.Contains(string(encoded), "{bad") {
		t.Fatal("malformed arguments broke audit", err)
	}
}
func TestLocalToolContinuationAndAudit(t *testing.T) {
	local := &fixtureTools{}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var p map[string]any
		json.NewDecoder(r.Body).Decode(&p)
		if calls == 1 {
			fmt.Fprint(w, `{"id":"one","choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":null,"reasoning_details":[{"type":"reasoning.text","text":"fixture"}],"tool_calls":[{"id":"c1","type":"function","function":{"name":"quran_fr","arguments":"{\"surah\":1,\"verse\":1}"}}]}}],"usage":{"server_tool_use_details":{"tool_calls_executed":2}}}`)
			return
		}
		if p["max_tool_calls"] != float64(14) {
			t.Error("web budget reset")
		}
		m := p["messages"].([]any)
		if len(m) != 4 || m[2].(map[string]any)["reasoning_details"] == nil || m[3].(map[string]any)["tool_call_id"] != "c1" {
			t.Error("continuation lost", m)
		}
		fmt.Fprint(w, `{"id":"two","choices":[{"finish_reason":"stop","message":{"content":"{}"}}],"usage":{"cost":0.001}}`)
	}))
	defer server.Close()
	r := Runner{Client: server.Client(), Endpoint: server.URL, Model: "allowed", LocalTools: local}
	out, e := r.Run(context.Background(), "fixture", "prompt", nil, nil)
	if e != nil || calls != 2 || local.calls != 1 || len(out.Audit.ModelUsage) != 2 || len(out.Audit.Local) != 1 || !strings.Contains(string(out.Audit.Local[0].Result), "fixture") {
		t.Fatal(out, e, calls)
	}
}
func TestLocalLoopCannotRunForever(t *testing.T) {
	local := &fixtureTools{}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		fmt.Fprint(w, `{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","tool_calls":[{"id":"c","type":"function","function":{"name":"quran_fr","arguments":"{}"}}]}}]}`)
	}))
	defer server.Close()
	r := Runner{Client: server.Client(), Endpoint: server.URL, Model: "allowed", LocalTools: local}
	_, e := r.Run(context.Background(), "fixture", "", nil, nil)
	if e == nil || calls != 5 || local.calls != 4 {
		t.Fatal(e, calls, local.calls)
	}
}
