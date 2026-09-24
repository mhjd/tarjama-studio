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
	for _, reason := range []string{"Réponse IA incomplète", "Réponse IA mal alignée", "Réponse IA invalide", "Réponse IA tronquée", "Marqueur technique interdit"} {
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
	if len(chunks) != 3 || len(chunks[0]) != 120 || len(chunks[1]) != 140 {
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
	if err != nil || len(resumed) != 3 || resumed[2][0].ID != source[260].ID {
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
