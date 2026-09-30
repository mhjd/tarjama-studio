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

func TestHadithToolCallsAreRejected(t *testing.T) {
	for _, name := range []string{"sahih_ar", "hadith_ar"} {
		t.Run(name, func(t *testing.T) {
			local := &fixtureTools{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, `{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","tool_calls":[{"id":"disabled","type":"function","function":{"name":%q,"arguments":"{}"}}]}}]}`, name)
			}))
			defer server.Close()
			runner := Runner{Client: server.Client(), Endpoint: server.URL, Model: "allowed", LocalTools: local}
			_, err := runner.Run(context.Background(), "fixture", "", nil, nil)
			var protocol *ProtocolError
			if !errors.As(err, &protocol) || protocol.Code != "tool_forbidden" || local.calls != 0 {
				t.Fatal("hadith call not rejected before execution", err, local.calls)
			}
		})
	}
}

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
		if payload["max_tool_calls"] != float64(4) || len(payload["tools"].([]any)) != 3 {
			t.Error("continuation lost its bounded web allowance")
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
		if p["max_tool_calls"] != float64(4) {
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
	if e == nil || calls != 6 || local.calls != 5 {
		t.Fatal(e, calls, local.calls)
	}
}

func TestServerToolUsageFormats(t *testing.T) {
	for _, sample := range []struct {
		raw   string
		calls int
		known bool
	}{
		{`{"server_tool_use_details":{"tool_calls_executed":3}}`, 3, true},
		{`{"server_tool_use":{"web_search_requests":2,"web_fetch_requests":1}}`, 3, true},
		{`{"server_tool_use":{"web_search_requests":0}}`, 0, false},
		{`{"server_tool_use":{"unknown_kind":2}}`, 0, false},
		{`{"server_tool_use":{"web_search_requests":-1}}`, 0, false},
		{`{"server_tool_use_details":{}}`, 0, false},
		{`{}`, 0, false},
		{`null`, 0, false},
		{`{"server_tool_use":{"web_search_requests":null,"web_fetch_requests":null}}`, 0, false},
		{`{"server_tool_use_details":{"tool_calls_executed":9223372036854775807}}`, 0, false},
	} {
		calls, known := serverToolCalls([]byte(sample.raw))
		if calls != sample.calls || known != sample.known {
			t.Fatal(sample.raw, calls, known)
		}
	}
}

func TestUsageAndIDSurviveHTTP200Error(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"id":"failed-id","usage":{"cost":0.001},"error":{"code":502,"message":"private"}}`)
	}))
	defer server.Close()
	runner := Runner{Client: server.Client(), Endpoint: server.URL, Model: "allowed"}
	out, err := runner.Run(context.Background(), "fixture", "", nil, nil)
	if err == nil || out.Audit.RequestID != "failed-id" || len(out.Audit.RequestIDs) != 1 || len(out.Audit.ModelUsage) != 1 {
		t.Fatal(out, err)
	}
}

func TestMissingOrPartialUsageNeverRenewsWebBudget(t *testing.T) {
	for _, usage := range []string{`null`, `{"server_tool_use":{"web_search_requests":0}}`} {
		t.Run(usage, func(t *testing.T) {
			reserved, calls := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var body map[string]any
				json.NewDecoder(r.Body).Decode(&body)
				if grant, ok := body["max_tool_calls"].(float64); ok {
					reserved += int(grant)
				}
				if body["tool_choice"] == "none" {
					fmt.Fprint(w, `{"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]}`)
					return
				}
				fmt.Fprintf(w, `{"usage":%s,"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","tool_calls":[{"id":"c","type":"function","function":{"name":"quran_fr","arguments":"{}"}}]}}]}`, usage)
			}))
			defer server.Close()
			runner := Runner{Client: server.Client(), Endpoint: server.URL, Model: "allowed", LocalTools: &fixtureTools{}}
			out, err := runner.Run(context.Background(), "fixture", "", nil, nil)
			if err != nil || calls != 6 || reserved != 16 || !out.Audit.WebUsageUnknown {
				t.Fatal(err, calls, reserved, out.Audit)
			}
		})
	}
}
