package studio

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

	"tarjama/web/internal/research"
)

func TestTextAttemptReservationSurvivesCrashAndManualRetry(t *testing.T) {
	s, owner, project := auditQueued(t)
	ctx := context.Background()
	var job Job
	for i := 0; i < maxTextChunkAttempts; i++ {
		var err error
		job, err = s.Claim(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.beginTextAttempt(ctx, job, 0); err != nil {
			t.Fatal(err)
		}
		// Simulate a crash after reservation: no response, no Fail callback.
		if _, err = s.DB.Exec(ctx, "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1", job.ID); err != nil {
			t.Fatal(err)
		}
	}
	provider := &scriptedProvider{}
	worker := Worker{Store: s, Config: Config{OpenRouterKey: "fixture"}, Providers: provider}
	if _, err := worker.Once(ctx); err != nil {
		t.Fatal(err)
	}
	jobs, _ := s.Jobs(ctx, owner, project.ID)
	if jobs[0].State != "failed" || provider.calls != 0 {
		t.Fatal("restart renewed spent budget", jobs, provider.calls)
	}
	if _, err := s.beginTextAttempt(ctx, job, 1); !errors.Is(err, ErrConflict) {
		t.Fatal("stale lease reserved work", err)
	}
	_, api := testAPI(t, s)
	token, csrf := sessionFor(t, s, owner)
	status, _ := call(t, api, token, csrf, "POST", "/api/projects/"+project.ID+"/jobs/"+job.ID+"/retry", nil)
	if status != 204 {
		t.Fatal(status)
	}
	for i := 0; i < 2; i++ {
		if _, err := worker.Once(ctx); err != nil {
			t.Fatal(err)
		}
	}
	jobs, _ = s.Jobs(ctx, owner, project.ID)
	var old, fresh int
	if err := s.DB.QueryRow(ctx, "SELECT count(*) FILTER(WHERE epoch=0),count(*) FILTER(WHERE epoch=1) FROM text_attempts WHERE job_id=$1", job.ID).Scan(&old, &fresh); err != nil {
		t.Fatal(err)
	}
	if jobs[0].State != "succeeded" || provider.calls != 1 || old != 4 || fresh != 1 {
		t.Fatal(jobs, provider.calls, old, fresh)
	}
}

func TestTextAttemptJournalIsPrivateAndBoundedMetadata(t *testing.T) {
	s, _, _ := auditQueued(t)
	ctx := context.Background()
	j, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	attempt, err := s.beginTextAttempt(ctx, j, 0)
	if err != nil {
		t.Fatal(err)
	}
	audit := research.Audit{ModelCalls: 2, RequestIDs: []string{"req-valid", "secret with whitespace"},
		ModelUsage: []json.RawMessage{[]byte(`{"cost":0.002,"prompt_tokens":123,"private":"secret payload"}`)},
		Local:      []research.LocalEvidence{{Name: "quran_fr", Arguments: []byte(`"private transcript"`), Result: []byte(`"private result"`)}}}
	raw, _ := json.Marshal(audit)
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err = s.finishTextAttempt(cancelled, attempt, time.Second, TextResult{Grounding: raw}, &ProviderError{Code: "http_502"}); err != nil {
		t.Fatal(err)
	}
	var code, diagnostic string
	var consumed bool
	if err = s.DB.QueryRow(ctx, "SELECT code,diagnostics::text,consumes_budget FROM text_attempts WHERE id=$1", attempt).Scan(&code, &diagnostic, &consumed); err != nil {
		t.Fatal(err)
	}
	if code != "http_502" || !consumed || !strings.Contains(diagnostic, "req-valid") || !strings.Contains(diagnostic, "0.002") || !strings.Contains(diagnostic, `"billing_may_be_incomplete": true`) {
		t.Fatal(code, diagnostic, consumed)
	}
	for _, forbidden := range []string{"secret", "private transcript", "private result", "private\""} {
		if strings.Contains(diagnostic, forbidden) {
			t.Fatal("journal leaked content", diagnostic)
		}
	}
	// First outcome is immutable if a stale completion arrives later.
	if err = s.finishTextAttempt(ctx, attempt, 0, TextResult{}, nil); err != nil {
		t.Fatal(err)
	}
	if err = s.DB.QueryRow(ctx, "SELECT code FROM text_attempts WHERE id=$1", attempt).Scan(&code); err != nil || code != "http_502" {
		t.Fatal(code, err)
	}
}

func TestQuotaRefusalsDoNotExhaustActiveBudget(t *testing.T) {
	s, owner, project := auditQueued(t)
	ctx := context.Background()
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.Header().Set("Retry-After", "120")
		w.WriteHeader(429)
	}))
	defer server.Close()
	provider := NewProviders()
	provider.TextURL = server.URL
	worker := Worker{Store: s, Config: Config{OpenRouterKey: "fixture"}, Providers: provider}
	for i := 0; i < 6; i++ {
		auditDue(t, s, true)
		if _, err := worker.Once(ctx); err != nil {
			t.Fatal(err)
		}
	}
	jobs, _ := s.Jobs(ctx, owner, project.ID)
	var consumed, count int
	if err := s.DB.QueryRow(ctx, "SELECT count(*) FILTER(WHERE consumes_budget),count(*) FROM text_attempts").Scan(&consumed, &count); err != nil {
		t.Fatal(err)
	}
	cooldown, err := s.Cooldown(ctx, "openrouter:shared")
	if err != nil || cooldown < time.Minute || jobs[0].State != "waiting_provider" || requests != 6 || count != 6 || consumed != 0 {
		t.Fatal(jobs, requests, count, consumed, cooldown, err)
	}
}

func TestQuotaAfterResearchDoesConsumeActiveBudget(t *testing.T) {
	s, _, _ := auditQueued(t)
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if requests == 1 {
			auditToolResponse(w, 1)
		} else {
			w.WriteHeader(429)
		}
	}))
	defer server.Close()
	provider := NewProviders()
	provider.TextURL = server.URL
	provider.References = &auditReferenceTools{}
	worker := Worker{Store: s, Config: Config{OpenRouterKey: "fixture"}, Providers: provider}
	if _, err := worker.Once(context.Background()); err != nil {
		t.Fatal(err)
	}
	var consumed bool
	var diagnostic string
	if err := s.DB.QueryRow(context.Background(), "SELECT consumes_budget,diagnostics::text FROM text_attempts").Scan(&consumed, &diagnostic); err != nil {
		t.Fatal(err)
	}
	if !consumed || !strings.Contains(diagnostic, `"model_calls": 2`) || !strings.Contains(diagnostic, "0.001") {
		t.Fatal(consumed, diagnostic)
	}
}

func TestProviderTimeoutDoesNotBlockOtherUsers(t *testing.T) {
	s, _, _ := auditQueued(t)
	requests := 0
	provider := NewProviders()
	provider.Client = &http.Client{Transport: auditTimeoutTransport{calls: &requests}}
	worker := Worker{Store: s, Config: Config{OpenRouterKey: "fixture"}, Providers: provider}
	if _, err := worker.Once(context.Background()); err != nil {
		t.Fatal(err)
	}
	if cooldown, err := s.Cooldown(context.Background(), "openrouter:shared"); err != nil || cooldown != 0 {
		t.Fatal(cooldown, err)
	}
}

func TestTextWholeJobBudgetCannotBeResetBySplitting(t *testing.T) {
	s, _, _ := auditQueued(t)
	ctx := context.Background()
	j, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Different ordinals model a pathological sequence of splits. The whole-job
	// bound must hold even though no per-chunk bound was reached.
	for i := 0; i < 12; i++ {
		if _, err = s.beginTextAttempt(ctx, j, i); err != nil {
			t.Fatal(i, err)
		}
	}
	if _, err = s.beginTextAttempt(ctx, j, 12); !errors.Is(err, errTextBudget) {
		t.Fatal(err)
	}
}

func TestTextContractConstrainsSegmentIDsAndLength(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		schema := body["response_format"].(map[string]any)["json_schema"].(map[string]any)["schema"].(map[string]any)
		array := schema["properties"].(map[string]any)["segments"].(map[string]any)
		ids := array["items"].(map[string]any)["properties"].(map[string]any)["id"].(map[string]any)["enum"].([]any)
		if array["minItems"] != float64(1) || array["maxItems"] != float64(1) || len(ids) != 1 || ids[0] != "requested" {
			t.Error("weak schema", array)
		}
		// Schema guidance never replaces local validation.
		fmt.Fprint(w, `{"choices":[{"finish_reason":"stop","message":{"content":"{\"segments\":[{\"id\":\"wrong\",\"text\":\"Bonjour\"}]}"}}]}`)
	}))
	defer server.Close()
	p := NewProviders()
	p.TextURL = server.URL
	if _, err := p.Text(context.Background(), "fixture", "translate", []Segment{{ID: "requested", Arabic: "سلام"}}, nil); err == nil || err.Error() != "Réponse IA mal alignée" {
		t.Fatal(err)
	}
}

func TestTextAttemptMigrationPreservesExistingProjectsAndJobs(t *testing.T) {
	s, owner, project := auditQueued(t)
	ctx := context.Background()
	// Recreate the previous schema around an existing project and queued job.
	if _, err := s.DB.Exec(ctx, `DROP TABLE text_attempts; ALTER TABLE jobs DROP COLUMN text_failures, DROP COLUMN text_epoch; DELETE FROM schema_migrations WHERE name='004_text_attempts.sql'`); err != nil {
		t.Fatal(err)
	}
	if err := s.Ready(ctx); err == nil {
		t.Fatal("worker could start before migration")
	}
	for range 2 {
		if err := s.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Ready(ctx); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, owner, project.ID)
	if err != nil || got.Segments[0].Arabic != project.Segments[0].Arabic || got.Version != project.Version {
		t.Fatal("migration changed project", err)
	}
	job, err := s.Claim(ctx)
	if err != nil || job.TextEpoch != 0 || job.TextFailures != 0 || job.ProjectID != project.ID {
		t.Fatal(job, err)
	}
}

func TestMalformedToolProtocolGetsBoundedSmallerRetry(t *testing.T) {
	for _, code := range []string{"tool_protocol", "tool_call", "tool_round_limit"} {
		for attempt := 0; attempt < 3; attempt++ {
			var failure *ProviderError
			err := textResponseFailure(Job{TextFailures: attempt}, &research.ProtocolError{Code: code})
			if !errors.As(err, &failure) || !failure.Malformed || failure.Temporary != (attempt < 2) || failure.Code != code {
				t.Fatal(code, attempt, err)
			}
		}
	}
	// Local execution/configuration and forbidden capabilities stay fail-closed.
	for _, code := range []string{"tool_forbidden", "tool_result"} {
		original := &research.ProtocolError{Code: code}
		if textResponseFailure(Job{}, original) != original {
			t.Fatal("unsafe tool failure retried", code)
		}
	}
}
