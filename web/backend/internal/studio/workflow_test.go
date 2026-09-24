package studio

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type scriptedProvider struct {
	calls   int
	keys    []string
	failure error
}

func (p *scriptedProvider) Text(_ context.Context, key, kind string, s, c []Segment) (TextResult, error) {
	p.calls++
	p.keys = append(p.keys, key)
	if p.failure != nil {
		return TextResult{}, p.failure
	}
	r := TextResult{}
	for _, x := range s {
		r.Segments = append(r.Segments, struct {
			ID   string `json:"id"`
			Text string `json:"text"`
		}{x.ID, "Bonjour"})
	}
	return r, nil
}
func (p *scriptedProvider) Audio(context.Context, string, string) (ASRResponse, json.RawMessage, error) {
	return ASRResponse{}, nil, errors.New("unexpected ASR")
}
func TestQuotaWaitPersonalKeyAndRestart(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, p := fixture(t, s)
	p.Segments[1].Start = 1200000
	p.Segments[1].End = 1202000
	_, e := s.Mutate(ctx, owner, p.ID, func(q *Project, tx pgx.Tx) error {
		*q = p
		q.Stage = "translating"
		return enqueue(ctx, tx, owner, *q, "translate")
	})
	if e != nil {
		t.Fatal(e)
	}
	provider := &scriptedProvider{failure: &ProviderError{Public: "Limite partagée", Temporary: true, After: time.Hour}}
	c := Config{EncryptionKey: make([]byte, 32), OpenRouterKey: "shared"}
	w := Worker{Store: s, Config: c, Providers: provider}
	if _, e = w.Once(ctx); e != nil {
		t.Fatal(e)
	}
	jobs, _ := s.Jobs(ctx, owner, p.ID)
	if jobs[0].State != "waiting_provider" {
		t.Fatal(jobs)
	}
	if worked, _ := w.Once(ctx); worked {
		t.Fatal("retry storm")
	}
	provider.failure = nil
	if e = s.SetKey(ctx, c, owner, "openrouter", "personal"); e != nil {
		t.Fatal(e)
	}
	if _, e = w.Once(ctx); e != nil {
		t.Fatal(e)
	}
	if provider.keys[1] != "personal" {
		t.Fatal(provider.keys)
	}
	chunks, _ := s.Chunks(ctx, Job{ID: jobs[0].ID})
	if len(chunks) != 1 {
		t.Fatal("partial progress lost")
	}
	// New worker after process restart picks the remaining chunk, not the first.
	restarted := Worker{Store: s, Config: c, Providers: provider}
	if _, e = restarted.Once(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e = restarted.Once(ctx); e != nil {
		t.Fatal(e)
	}
	updated, e := s.Get(ctx, owner, p.ID)
	if e != nil || updated.Stage != "review" || updated.TranslationSource != updated.ArabicVersion || provider.calls != 3 {
		t.Fatal(updated, e, provider.calls)
	}
}
func TestArabicEditInvalidatesAndLateTranslationCannotOverwrite(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, p := fixture(t, s)
	_, server := testAPI(t, s)
	token, csrf := sessionFor(t, s, owner)
	s.Mutate(ctx, owner, p.ID, func(q *Project, tx pgx.Tx) error {
		q.Stage = "ready"
		q.ConfirmedArabic = q.ArabicVersion
		q.TranslationSource = q.ArabicVersion
		q.ConfirmedReview = q.Version
		for i := range q.Segments {
			q.Segments[i].French = "Retouche humaine"
		}
		return enqueue(ctx, tx, owner, *q, "translate")
	})
	j, e := s.Claim(ctx)
	if e != nil {
		t.Fatal(e)
	}
	status, _ := call(t, server, token, csrf, "PATCH", "/api/projects/"+p.ID+"/segments/one", map[string]any{"field": "arabic", "text": "نص جديد", "version": 1})
	if status != 200 {
		t.Fatal(status)
	}
	updated, _ := s.Get(ctx, owner, p.ID)
	if updated.Stage != "arabic" || updated.ConfirmedReview != 0 || updated.ConfirmedArabic != 0 || updated.Segments[0].French != "Retouche humaine" {
		t.Fatal(updated)
	}
	if e = s.Finish(ctx, j, func(q *Project) error { q.Segments[0].French = "Late overwrite"; return nil }, ""); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
	status, _ = call(t, server, token, csrf, "POST", "/api/projects/"+p.ID+"/advance", map[string]any{"version": updated.Version, "stage": "arabic"})
	if status != 400 {
		t.Fatal("replacement lacked consent", status)
	}
}
func TestCancelledLeaseAndCooldownIsolation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, p := fixture(t, s)
	s.Mutate(ctx, owner, p.ID, func(p *Project, tx pgx.Tx) error { return enqueue(ctx, tx, owner, *p, "translate") })
	j, e := s.Claim(ctx)
	if e != nil {
		t.Fatal(e)
	}
	s.DB.Exec(ctx, "UPDATE jobs SET state='cancelled',lease='' WHERE id=$1", j.ID)
	if s.Heartbeat(ctx, j) {
		t.Fatal("cancel heartbeat accepted")
	}
	if e = s.Chunk(ctx, j, 0, TextResult{}, TextModel, "v1", 1); !errors.Is(e, ErrConflict) {
		t.Fatal("late chunk", e)
	}
	if e = s.SetCooldown(ctx, "openrouter:shared", time.Hour); e != nil {
		t.Fatal(e)
	}
	if d, e := s.Cooldown(ctx, "openrouter:personal"); e != nil || d != 0 {
		t.Fatal("personal blocked", d, e)
	}
}

func TestProviderStructuredWireValidation(t *testing.T) {
	source := []Segment{{ID: "a", Arabic: "سلام"}}
	for _, tc := range []struct {
		content, finish string
		valid           bool
	}{
		{`{"segments":[{"id":"a","text":"Bonjour"}]}`, "stop", true},
		{`{"segments":[{"id":"a","text":"Bonjour","start":0}]}`, "stop", false},
		{`{"segments":[]}`, "stop", false},
		{`{"segments":[{"id":"a","text":"Bonjour"}]}`, "length", false},
		{`{"segments":[`, "stop", false},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var body map[string]any
			if json.NewDecoder(r.Body).Decode(&body) != nil {
				t.Fatal("request JSON")
			}
			if body["messages"] == nil || body["response_format"] == nil {
				t.Error("missing fixed instruction/schema")
			}
			json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": tc.finish, "message": map[string]any{"role": "assistant", "content": tc.content}}}})
		}))
		p := NewProviders()
		p.Research.Key = "parallel-fixture-only"
		p.TextURL = server.URL
		_, e := p.Text(context.Background(), "fixture", "translate", source, nil)
		server.Close()
		if (e == nil) != tc.valid {
			t.Fatal(tc, e)
		}
	}
}
func TestGroqMultipartContract(t *testing.T) {
	file := filepath.Join(t.TempDir(), "audio.flac")
	os.WriteFile(file, []byte("fLaCfixture"), 0600)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture" {
			t.Error("authorization")
		}
		if e := r.ParseMultipartForm(1024); e != nil {
			t.Fatal(e)
		}
		defer r.MultipartForm.RemoveAll()
		for k, v := range map[string]string{"model": GroqModel, "language": "ar", "response_format": "verbose_json"} {
			if r.FormValue(k) != v {
				t.Error(k)
			}
		}
		if len(r.MultipartForm.Value["timestamp_granularities[]"]) != 2 {
			t.Error("missing timestamp detail")
		}
		f, _, e := r.FormFile("file")
		if e != nil {
			t.Fatal(e)
		}
		f.Close()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"segments":[{"start":0,"end":1,"text":"سلام"}],"words":[{"start":0,"end":1,"word":"سلام"}]}`))
	}))
	defer server.Close()
	p := NewProviders()
	p.Research.Key = "parallel-fixture-only"
	p.GroqURL = server.URL
	response, raw, e := p.Audio(context.Background(), "fixture", file)
	if e != nil || len(response.Segments) != 1 || len(raw) == 0 {
		t.Fatal(response, e)
	}
}

func TestWorkerResumesLegacyTextChunkAfterUpgrade(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, p := fixture(t, s)
	p.Segments = twentyMinuteSegments()
	p.Duration = 1200000
	_, err := s.Mutate(ctx, owner, p.ID, func(q *Project, tx pgx.Tx) error {
		*q = p
		q.Stage = "translating"
		return enqueue(ctx, tx, owner, *q, "translate")
	})
	if err != nil {
		t.Fatal(err)
	}
	oldJob, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	provider := &scriptedProvider{}
	oldResult, _ := provider.Text(ctx, "", "translate", p.Segments[:120], nil)
	if err = s.Chunk(ctx, oldJob, 0, oldResult, "gemini-3.8-flash", "translate-v1", 30); err != nil {
		t.Fatal(err)
	}
	provider.calls = 0
	worker := Worker{Store: s, Config: Config{OpenRouterKey: "fixture"}, Providers: provider}
	for i := 0; i < 2; i++ {
		if worked, e := worker.Once(ctx); e != nil || !worked {
			t.Fatal(worked, e)
		}
	}
	actual, err := s.Get(ctx, owner, p.ID)
	if err != nil || actual.Stage != "review" || len(actual.Segments) != 400 || provider.calls != 1 {
		t.Fatalf("resume failed: stage=%s calls=%d err=%v", actual.Stage, provider.calls, err)
	}
	for i, x := range actual.Segments {
		if x.ID != p.Segments[i].ID || x.Start != p.Segments[i].Start || x.End != p.Segments[i].End || x.French != "Bonjour" {
			t.Fatalf("segment %d corrupted", i)
		}
	}
	saved, err := s.Chunks(ctx, oldJob)
	if err != nil || len(saved) != 2 {
		t.Fatal("old completed chunk lost", err)
	}
}
