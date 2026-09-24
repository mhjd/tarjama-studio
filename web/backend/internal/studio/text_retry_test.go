package studio

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTextRetriesBoundedAndFailClosed(t *testing.T) {
	for _, reason := range []string{"Réponse OpenRouter invalide", "Réponse modèle vide", "Réponse IA incomplète", "Réponse IA mal alignée", "Réponse IA invalide", "Réponse IA tronquée", "Marqueur technique interdit"} {
		for attempt := 0; attempt < 4; attempt++ {
			var p *ProviderError
			if !errors.As(textResponseFailure(Job{Attempts: attempt}, errors.New(reason)), &p) || p.Temporary != (attempt < 2) {
				t.Fatal(reason, attempt)
			}
		}
	}
	for _, original := range []error{errors.New("Réponse IA tronquée ou refusée"), errors.New("unknown"), &ProviderError{Public: "key refused"}} {
		if textResponseFailure(Job{}, original) != original {
			t.Fatal("permanent/unknown error retried")
		}
	}
}
func TestTextRetryPreservesSavedBoundaries(t *testing.T) {
	source := twentyMinuteSegments()
	completed, _ := (&scriptedProvider{}).Text(context.Background(), "", "cleanup", source[:120], nil)
	raw, _ := json.Marshal(completed)
	chunks, err := resumeTextChunks(source, []json.RawMessage{raw})
	if err != nil {
		t.Fatal(err)
	}
	chunks = smallerTextRetry(chunks, 1, 1)
	if len(chunks) != 4 || len(chunks[0]) != 120 || len(chunks[1]) != 100 {
		t.Fatal("boundaries", len(chunks))
	}
	n := 0
	for _, chunk := range chunks {
		for _, s := range chunk {
			if s.ID != source[n].ID {
				t.Fatal("lost/reordered ID")
			}
			n++
		}
	}
	if n != len(source) {
		t.Fatal("lost suffix")
	}
	recovered, _ := (&scriptedProvider{}).Text(context.Background(), "", "cleanup", chunks[1], nil)
	next, _ := json.Marshal(recovered)
	resumed, err := resumeTextChunks(source, []json.RawMessage{raw, next})
	if err != nil || len(resumed) != 3 || resumed[2][0].ID != source[220].ID {
		t.Fatal("restart replayed completed work", err)
	}
	if got := smallerTextRetry([][]Segment{{source[0]}}, 0, 2); len(got) != 1 || len(got[0]) != 1 {
		t.Fatal("single segment lost")
	}
}
func TestTextOutputLimitDiffersFromRefusal(t *testing.T) {
	for _, reason := range []string{"length", "content_filter"} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprintf(w, `{"choices":[{"finish_reason":%q}]}`, reason)
		}))
		p := NewProviders()
		p.TextURL = server.URL
		_, err := p.Text(context.Background(), "test-only", "cleanup", []Segment{{ID: "a", Arabic: "سلام"}}, nil)
		server.Close()
		var transient *ProviderError
		recovered := textResponseFailure(Job{}, err)
		retry := errors.As(recovered, &transient) && transient.Temporary
		if retry != (reason == "length") {
			t.Fatal(reason, err)
		}
	}
}
func TestRawTranscriptionCannotBeEdited(t *testing.T) {
	s := testStore(t)
	owner, p := fixture(t, s)
	_, server := testAPI(t, s)
	token, csrf := sessionFor(t, s, owner)
	for _, stage := range []string{"transcribing", "cleaning"} {
		_, err := s.Mutate(context.Background(), owner, p.ID, func(p *Project, tx pgx.Tx) error { p.Stage = stage; return nil })
		if err != nil {
			t.Fatal(err)
		}
		status, _ := call(t, server, token, csrf, "PATCH", "/api/projects/"+p.ID+"/segments/one", map[string]any{"field": "arabic", "text": "do not save raw edits", "version": 1})
		if status == 200 {
			t.Fatal("raw transcript editable", stage)
		}
		after, err := s.Get(context.Background(), owner, p.ID)
		if err != nil || after.Segments[0].Arabic != p.Segments[0].Arabic || after.Version != p.Version {
			t.Fatal("raw transcript changed", err)
		}
	}
}

func TestMalformedTextQueueRecoveryAndAttemptLimit(t *testing.T) {
	for _, recoverResponse := range []bool{true, false} {
		t.Run(fmt.Sprint(recoverResponse), func(t *testing.T) {
			s := testStore(t)
			ctx := context.Background()
			owner, p := fixture(t, s)
			_, err := s.Mutate(ctx, owner, p.ID, func(q *Project, tx pgx.Tx) error { q.Stage = "cleaning"; return enqueue(ctx, tx, owner, *q, "cleanup") })
			if err != nil {
				t.Fatal(err)
			}
			provider := &scriptedProvider{failure: errors.New("Réponse IA incomplète")}
			worker := Worker{Store: s, Config: Config{OpenRouterKey: "fixture"}, Providers: provider}
			if _, err = worker.Once(ctx); err != nil && !errors.Is(err, pgx.ErrNoRows) {
				t.Fatal(err)
			}
			jobs, _ := s.Jobs(ctx, owner, p.ID)
			if jobs[0].State != "waiting_provider" {
				t.Fatal(jobs)
			}
			if worked, _ := worker.Once(ctx); worked {
				t.Fatal("immediate retry storm")
			}
			if recoverResponse {
				provider.failure = nil
			}
			for i := 0; i < 4; i++ {
				s.DB.Exec(ctx, "UPDATE jobs SET next_attempt_at=now() WHERE id=$1", jobs[0].ID)
				if _, err = worker.Once(ctx); err != nil && !errors.Is(err, pgx.ErrNoRows) {
					t.Fatal(err)
				}
			}
			final, _ := s.Get(ctx, owner, p.ID)
			jobs, _ = s.Jobs(ctx, owner, p.ID)
			if recoverResponse {
				chunks, _ := s.Chunks(ctx, Job{ID: jobs[0].ID})
				if jobs[0].State != "succeeded" || final.Stage != "arabic" || len(chunks) != 2 || len(final.Segments) != 2 {
					t.Fatal("resume did not publish complete result", jobs, final.Stage, len(chunks))
				}
			} else {
				if jobs[0].State != "failed" || provider.calls != 3 || final.Stage != "cleaning" || final.Segments[0].Arabic != p.Segments[0].Arabic {
					t.Fatal("unbounded retry or partial publish", jobs, provider.calls)
				}
			}
		})
	}
}

func TestHTTP200FailurePreservesCompletedTranslation(t *testing.T) {
	for _, broken := range []string{`{"error":{"code":502,"message":"private diagnostic"}}`, `{"choices":[{"finish_reason":"stop","message":{"content":""}}]}`} {
		t.Run(broken, func(t *testing.T) {
			s := testStore(t)
			ctx := context.Background()
			owner, p := fixture(t, s)
			p.Segments[1].Start = 600001
			p.Segments[1].End = 602001
			_, err := s.Mutate(ctx, owner, p.ID, func(q *Project, tx pgx.Tx) error {
				*q = p
				q.Stage = "translating"
				return enqueue(ctx, tx, owner, *q, "translate")
			})
			if err != nil {
				t.Fatal(err)
			}
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var request struct {
					Messages []struct {
						Content string `json:"content"`
					} `json:"messages"`
				}
				if json.NewDecoder(r.Body).Decode(&request) != nil {
					t.Error("bad request")
					return
				}
				var input struct {
					Segments []struct {
						ID string `json:"id"`
					} `json:"segments"`
				}
				if json.Unmarshal([]byte(request.Messages[1].Content), &input) != nil || len(input.Segments) != 1 {
					t.Error("bad chunk")
					return
				}
				want := p.Segments[0].ID
				if calls > 1 {
					want = p.Segments[1].ID
				}
				if input.Segments[0].ID != want {
					t.Error("completed chunk replayed")
				}
				if calls == 2 {
					fmt.Fprint(w, broken)
					return
				}
				content, _ := json.Marshal(map[string]any{"segments": []map[string]string{{"id": want, "text": "Bonjour"}}})
				fmt.Fprintf(w, `{"choices":[{"finish_reason":"stop","message":{"content":%q}}]}`, string(content))
			}))
			defer server.Close()
			provider := NewProviders()
			provider.TextURL = server.URL
			worker := Worker{Store: s, Config: Config{OpenRouterKey: "fixture"}, Providers: provider}
			for i := 0; i < 2; i++ {
				if _, err = worker.Once(ctx); err != nil {
					t.Fatal(err)
				}
			}
			jobs, _ := s.Jobs(ctx, owner, p.ID)
			saved, _ := s.Chunks(ctx, Job{ID: jobs[0].ID})
			if jobs[0].State != "waiting_provider" || len(saved) != 1 {
				t.Fatal("lost chunk or terminal failure", jobs, len(saved))
			}
			if worked, _ := worker.Once(ctx); worked {
				t.Fatal("immediate retry")
			}
			current, _ := s.Get(ctx, owner, p.ID)
			if current.Stage != "translating" || current.Segments[0].French != p.Segments[0].French {
				t.Fatal("partial translation published")
			}
			if _, err = s.DB.Exec(ctx, "UPDATE jobs SET next_attempt_at=now(); UPDATE cooldowns SET until_at=now()"); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				if _, err = worker.Once(ctx); err != nil {
					t.Fatal(err)
				}
			}
			jobs, _ = s.Jobs(ctx, owner, p.ID)
			after, _ := s.Chunks(ctx, Job{ID: jobs[0].ID})
			current, _ = s.Get(ctx, owner, p.ID)
			if calls != 3 || jobs[0].State != "succeeded" || len(after) != 2 || string(after[0]) != string(saved[0]) || current.Stage != "review" || current.Segments[1].French != "Bonjour" {
				t.Fatal("recovery did not preserve completed work", calls, jobs, current.Stage)
			}
		})
	}
}
