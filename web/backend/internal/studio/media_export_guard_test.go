package studio

import (
	"context"
	"reflect"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestExportWaitsForMediaRecovery(t *testing.T) {
	for _, kind := range []string{"restore_download", "restore_prepare"} {
		for _, state := range []string{"queued", "running", "waiting_provider"} {
			t.Run(kind+"/"+state, func(t *testing.T) {
				ctx := context.Background()
				s := testStore(t)
				api, server := testAPI(t, s)
				owner, p := readyVideo(t, s, api.Config.Storage, false)
				if err := s.ExpireVideos(ctx, api.Config.Storage, time.Now().Add(8*24*time.Hour)); err != nil {
					t.Fatal(err)
				}
				_, err := s.Mutate(ctx, owner, p.ID, func(p *Project, tx pgx.Tx) error {
					for _, k := range []string{kind, "export_fr_low", "export_fr_high"} {
						if err := enqueue(ctx, tx, owner, *p, k); err != nil {
							return err
						}
					}
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
				jobs, err := s.Jobs(ctx, owner, p.ID)
				if err != nil {
					t.Fatal(err)
				}
				ids := map[string]string{}
				for _, job := range jobs {
					ids[job.Kind] = job.ID
				}
				if _, err = s.DB.Exec(ctx, `UPDATE jobs SET state=CASE WHEN kind=$2 THEN $3 WHEN kind='export_fr_low' THEN 'expired' ELSE 'cancelled' END WHERE project_id=$1`, p.ID, kind, state); err != nil {
					t.Fatal(err)
				}
				token, csrf := sessionFor(t, s, owner)
				path := "/api/projects/" + p.ID
				code, body := call(t, server, token, csrf, "POST", path+"/exports", map[string]any{"version": p.Version, "track": "fr", "quality": "low"})
				if code != 409 {
					t.Fatalf("export while %s: %d %s", state, code, body)
				}
				code, body = call(t, server, token, csrf, "POST", path+"/jobs/"+ids["export_fr_high"]+"/retry", nil)
				if code != 409 {
					t.Fatalf("retry bypass: %d %s", code, body)
				}
				jobs, err = s.Jobs(ctx, owner, p.ID)
				if err != nil || len(jobs) != 3 {
					t.Fatal(jobs, err)
				}
				for _, job := range jobs {
					want := map[string]string{kind: state, "export_fr_low": "expired", "export_fr_high": "cancelled"}[job.Kind]
					if job.State != want {
						t.Fatalf("rejected request changed job: %+v", job)
					}
				}
				got, err := s.Get(ctx, owner, p.ID)
				if err != nil || !reflect.DeepEqual(got.Segments, p.Segments) || got.Version != p.Version {
					t.Fatal("texts changed", err)
				}
				// Existing subtitles remain downloadable, independently of the video.
				code, _ = call(t, server, token, csrf, "GET", path+"/subtitles/fr.srt?version="+strconv.FormatInt(p.Version, 10), nil)
				if code != 200 {
					t.Fatal("SRT unavailable", code)
				}
				if _, err = s.DB.Exec(ctx, "UPDATE jobs SET state='cancelled' WHERE id=$1", ids[kind]); err != nil {
					t.Fatal(err)
				}
				code, body = call(t, server, token, csrf, "POST", path+"/exports", map[string]any{"version": p.Version, "track": "fr", "quality": "low"})
				if code != 200 {
					t.Fatalf("export should restore its own source after cancellation: %d %s", code, body)
				}
				// The reverse retry must also be rejected: no competing restoration.
				code, body = call(t, server, token, csrf, "POST", path+"/jobs/"+ids[kind]+"/retry", nil)
				if code != 409 {
					t.Fatalf("restore retry during export: %d %s", code, body)
				}
			})
		}
	}
}

func TestConcurrentExportAndRecoveryDoNotOverlap(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	api, server := testAPI(t, s)
	owner, p := readyVideo(t, s, api.Config.Storage, false)
	if err := s.ExpireVideos(ctx, api.Config.Storage, time.Now().Add(8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	token, csrf := sessionFor(t, s, owner)
	start := make(chan struct{})
	results := make(chan int, 2)
	var wg sync.WaitGroup
	for _, restore := range []bool{false, true} {
		wg.Add(1)
		go func(restore bool) {
			defer wg.Done()
			<-start
			path := "/api/projects/" + p.ID + "/exports"
			var body any = map[string]any{"version": p.Version, "track": "fr", "quality": "low"}
			if restore {
				path = "/api/projects/" + p.ID + "/media/restore"
				body = nil
			}
			code, _ := call(t, server, token, csrf, "POST", path, body)
			results <- code
		}(restore)
	}
	close(start)
	wg.Wait()
	close(results)
	successes := 0
	for code := range results {
		if code == 200 {
			successes++
		}
	}
	jobs, err := s.Jobs(ctx, owner, p.ID)
	if err != nil || successes != 1 || len(jobs) != 1 {
		t.Fatalf("competing jobs: successes=%d jobs=%+v err=%v", successes, jobs, err)
	}
}
