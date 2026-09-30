package studio

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func readyVideo(t *testing.T, s *Store, root string, uploaded bool) (string, Project) {
	t.Helper()
	owner, p := fixture(t, s)
	p.Stage = "ready"
	p.TranslationSource = p.ArabicVersion
	p.ConfirmedReview = p.Version
	p.Media = "source-" + p.ID + ".mp4"
	p.MediaUploaded = uploaded
	p.Duration = 4000
	if !uploaded {
		p.URL = "https://www.youtube.com/watch?v=b1MKJ5gHig0"
	}
	for i := range p.Segments {
		p.Segments[i].French = "Texte corrigé"
	}
	renewMediaExpiry(&p, time.Now())
	if _, err := s.Mutate(context.Background(), owner, p.ID, func(q *Project, _ pgx.Tx) error { *q = p; return nil }); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(storagePath(root, p.Media), []byte("source video"), 0600); err != nil {
		t.Fatal(err)
	}
	return owner, p
}
func TestVideoRetentionPreservesTextBackupAndActiveWork(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	root := t.TempDir()
	owner, p := readyVideo(t, s, root, false)
	_, upload := readyVideo(t, s, root, true)
	p.Archived = true
	s.Mutate(ctx, owner, p.ID, func(q *Project, _ pgx.Tx) error { q.Archived = true; return nil })
	before, _ := json.Marshal(p.Segments)
	backup := filepath.Join(root, "backups")
	os.Mkdir(backup, 0700)
	os.WriteFile(filepath.Join(backup, "keep.dump"), []byte("backup"), 0600)
	_, err := s.Mutate(ctx, owner, p.ID, func(p *Project, tx pgx.Tx) error { return enqueue(ctx, tx, owner, *p, "export_fr_low") })
	if err != nil {
		t.Fatal(err)
	}
	jobs, _ := s.Jobs(ctx, owner, p.ID)
	job := jobs[0]
	output := storagePath(root, job.ID+".mp4")
	os.WriteFile(output, []byte("rendered video"), 0600)
	s.DB.Exec(ctx, "UPDATE jobs SET state='succeeded',updated_at=now() WHERE id=$1", job.ID)
	if err = s.ExpireVideos(ctx, root, time.Now().Add(25*time.Hour)); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{p.Media, upload.Media, job.ID + ".mp4"} {
		if _, err := os.Stat(storagePath(root, name)); err != nil {
			t.Fatal("video lost after one day", name, err)
		}
	}
	s.DB.Exec(ctx, "UPDATE jobs SET state='queued' WHERE id=$1", job.ID)
	future := time.Now().Add(8 * 24 * time.Hour)
	if err = s.ExpireVideos(ctx, root, future); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(storagePath(root, p.Media)); err != nil {
		t.Fatal("active job lost source", err)
	}
	s.DB.Exec(ctx, "UPDATE jobs SET state='succeeded',updated_at=now() WHERE id=$1", job.ID)
	if err = s.ExpireVideos(ctx, root, future); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, owner, p.ID)
	after, _ := json.Marshal(got.Segments)
	if got.Media != "" || !got.MediaExpired || string(before) != string(after) || got.Stage != "ready" || got.Version != p.Version {
		t.Fatal("text/stage corrupted", got)
	}
	for _, name := range []string{storagePath(root, p.Media), output} {
		if _, err = os.Stat(name); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("video retained", name, err)
		}
	}
	if _, err = os.Stat(filepath.Join(backup, "keep.dump")); err != nil {
		t.Fatal("backup lost", err)
	}
	jobs, _ = s.Jobs(ctx, owner, p.ID)
	if jobs[0].State != "expired" {
		t.Fatal(jobs)
	}
	if err = s.ExpireVideos(ctx, root, time.Now().Add(8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(storagePath(root, upload.Media)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("upload not expired", err)
	}
}

func TestExistingMediaDeadlinesUpgradeOnceToOneWeek(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	root := t.TempDir()
	for _, uploaded := range []bool{false, true} {
		owner, p := readyVideo(t, s, root, uploaded)
		now := time.Now().UTC().Truncate(time.Second)
		oldExpiry := now.Add(-time.Hour)
		if uploaded {
			oldExpiry = now.Add(2 * 24 * time.Hour)
		}
		_, err := s.Mutate(ctx, owner, p.ID, func(q *Project, _ pgx.Tx) error {
			q.MediaExpiresAt = &oldExpiry
			q.MediaRetentionDays = 0
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		wantExpiry := oldExpiry
		if !uploaded {
			wantExpiry = oldExpiry.Add(6 * 24 * time.Hour)
		}
		for i := 0; i < 2; i++ {
			if err := s.ExpireVideos(ctx, root, now.Add(time.Duration(i)*time.Minute)); err != nil {
				t.Fatal(err)
			}
			got, err := s.Get(ctx, owner, p.ID)
			if err != nil || got.MediaExpiresAt == nil || !got.MediaExpiresAt.Equal(wantExpiry) || got.MediaRetentionDays != 7 || got.Media != p.Media || got.Version != p.Version || !reflect.DeepEqual(got.Segments, p.Segments) {
				t.Fatal("deadline upgrade changed data or repeated", uploaded, got, err)
			}
		}
		if err := s.ExpireVideos(ctx, root, wantExpiry); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(storagePath(root, p.Media)); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("video not removed at deadline", err)
		}
	}
}

type restoringMedia struct {
	calls    []string
	duration int64
}

func (m *restoringMedia) Process(_ context.Context, r MediaRequest, input, output string) (MediaInfo, error) {
	m.calls = append(m.calls, r.Operation)
	if r.Operation == "export" {
		if _, err := os.Stat(input); err != nil {
			return MediaInfo{}, err
		}
	}
	err := os.WriteFile(output, []byte("restored or exported video"), 0600)
	return MediaInfo{Duration: m.duration, Width: 640, Height: 360}, err
}
func TestExpiredExportRedownloadsWithoutTouchingTexts(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	api, server := testAPI(t, s)
	owner, p := readyVideo(t, s, api.Config.Storage, false)
	token, csrf := sessionFor(t, s, owner)
	path := "/api/projects/" + p.ID + "/exports"
	code, _ := call(t, server, token, csrf, "POST", path, map[string]any{"version": p.Version, "track": "fr", "quality": "low"})
	if code != 200 {
		t.Fatal(code)
	}
	m := &restoringMedia{duration: 4000}
	w := Worker{Store: s, Config: api.Config, Media: m}
	if _, err := w.Once(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.ExpireVideos(ctx, api.Config.Storage, time.Now().Add(8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	code, _ = call(t, server, token, csrf, "POST", path, map[string]any{"version": p.Version, "track": "fr", "quality": "low"})
	if code != 200 {
		t.Fatal(code)
	}
	if _, err := w.Once(ctx); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(m.calls, []string{"export", "download", "export"}) {
		t.Fatal(m.calls)
	}
	got, _ := s.Get(ctx, owner, p.ID)
	if !reflect.DeepEqual(p.Segments, got.Segments) || got.Version != p.Version || got.Stage != "ready" || got.Media == "" || got.MediaExpired {
		t.Fatal("restoration changed text or workflow", got)
	}
	jobs, _ := s.Jobs(ctx, owner, p.ID)
	if len(jobs) != 1 || jobs[0].State != "succeeded" {
		t.Fatal("duplicate or AI jobs", jobs)
	}
}
func TestRetentionGraceAndRestoreRejectsDifferentDuration(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	api, server := testAPI(t, s)
	owner, p := readyVideo(t, s, api.Config.Storage, false)
	s.Mutate(ctx, owner, p.ID, func(q *Project, _ pgx.Tx) error { q.MediaExpiresAt = nil; return nil })
	if err := s.ExpireVideos(ctx, api.Config.Storage, time.Now()); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, owner, p.ID)
	if got.Media == "" || got.MediaExpiresAt == nil {
		t.Fatal("legacy grace missing")
	}
	if err := s.ExpireVideos(ctx, api.Config.Storage, time.Now().Add(8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	token, csrf := sessionFor(t, s, owner)
	code, _ := call(t, server, token, csrf, "POST", "/api/projects/"+p.ID+"/exports", map[string]any{"version": p.Version, "track": "fr", "quality": "low"})
	if code != 200 {
		t.Fatal(code)
	}
	m := &restoringMedia{duration: 20000}
	w := Worker{Store: s, Config: api.Config, Media: m}
	w.Once(ctx)
	jobs, _ := s.Jobs(ctx, owner, p.ID)
	if jobs[0].State != "failed" || len(m.calls) != 1 {
		t.Fatal("changed video rendered", jobs, m.calls)
	}
	got, _ = s.Get(ctx, owner, p.ID)
	if !reflect.DeepEqual(got.Segments, p.Segments) || got.Media != "" {
		t.Fatal("mismatched source applied")
	}
}

func TestReimportRestoresMediaWithoutAIOrTextLoss(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	a, server := testAPI(t, s)
	owner, p := readyVideo(t, s, a.Config.Storage, true)
	if err := s.ExpireVideos(ctx, a.Config.Storage, time.Now().Add(8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	token, csrf := sessionFor(t, s, owner)
	path := "/api/projects/" + p.ID
	code, _ := call(t, server, token, csrf, "POST", path+"/exports", map[string]any{"version": 1, "track": "fr", "quality": "low"})
	if code != 400 {
		t.Fatal("missing upload accepted", code)
	}
	code, _ = call(t, server, token, csrf, "PUT", path+"/media/reimport", "synthetic input video for controlled media engine")
	if code != 200 {
		t.Fatal("reimport refused", code)
	}
	// Text may be edited while normalization runs; media publication must not replace it.
	code, _ = call(t, server, token, csrf, "PATCH", path+"/segments/one", map[string]any{"version": 1, "field": "french", "text": "Correction pendant la récupération"})
	if code != 200 {
		t.Fatal(code)
	}
	m := &restoringMedia{duration: 4000}
	w := Worker{Store: s, Config: a.Config, Media: m}
	if _, err := w.Once(ctx); err != nil {
		t.Fatal(err)
	}
	got, _ := s.Get(ctx, owner, p.ID)
	if got.Segments[0].French != "Correction pendant la récupération" || got.Stage != "review" || got.Media == "" || got.MediaExpired || !got.MediaUploaded {
		t.Fatal(got)
	}
	jobs, _ := s.Jobs(ctx, owner, p.ID)
	if len(jobs) != 1 || jobs[0].Kind != "restore_prepare" || jobs[0].State != "succeeded" || !reflect.DeepEqual(m.calls, []string{"prepare"}) {
		t.Fatal(jobs, m.calls)
	}
	if got.MediaExpiresAt == nil || time.Until(*got.MediaExpiresAt) < 167*time.Hour {
		t.Fatal("upload week missing")
	}
	if got.SourceSHA256 == "" {
		t.Fatal("validated original fingerprint not stored")
	}
	if err := s.ExpireVideos(ctx, a.Config.Storage, time.Now().Add(8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	code, _ = call(t, server, token, csrf, "PUT", path+"/media/reimport", "synthetic input video for controlled media engine")
	if code != 200 {
		t.Fatal("same original rejected", code)
	}
	if _, err := w.Once(ctx); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Get(ctx, owner, p.ID)
	if got.Media == "" || got.Segments[0].French != "Correction pendant la récupération" {
		t.Fatal("repeat import changed text")
	}

}

func TestReimportRejectsWrongFileWhenOriginalHashKnown(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	a, server := testAPI(t, s)
	owner, p := readyVideo(t, s, a.Config.Storage, true)
	s.Mutate(ctx, owner, p.ID, func(q *Project, _ pgx.Tx) error { q.SourceSHA256 = "not-the-uploaded-hash"; return nil })
	if err := s.ExpireVideos(ctx, a.Config.Storage, time.Now().Add(8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	token, csrf := sessionFor(t, s, owner)
	code, _ := call(t, server, token, csrf, "PUT", "/api/projects/"+p.ID+"/media/reimport", "different original file with same duration")
	if code != 400 {
		t.Fatal("wrong input accepted", code)
	}
	jobs, _ := s.Jobs(ctx, owner, p.ID)
	if len(jobs) != 0 {
		t.Fatal("wrong file was scheduled", jobs)
	}
	got, _ := s.Get(ctx, owner, p.ID)
	if !reflect.DeepEqual(p.Segments, got.Segments) || got.Media != "" {
		t.Fatal("wrong file changed project")
	}
}

// Simulate only the remote download; preparation and subtitle encoding use FFmpeg.
type downloadedFixtureMedia struct {
	source    string
	downloads int
}

func (m *downloadedFixtureMedia) Process(ctx context.Context, r MediaRequest, input, output string) (MediaInfo, error) {
	if r.Operation == "download" {
		m.downloads++
		r.Operation = "prepare"
		input = m.source
	}
	return (LocalMedia{Test: true}).Process(ctx, r, input, output)
}
func TestRetentionRealMediaRestoreAndExport(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg required")
	}
	ctx := context.Background()
	s := testStore(t)
	a, server := testAPI(t, s)
	original := filepath.Join(t.TempDir(), "original.mp4")
	cmd := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=0x31453b:s=320x240:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", original)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatal(err, string(output))
	}
	owner, p := readyVideo(t, s, a.Config.Storage, false)
	if err := s.ExpireVideos(ctx, a.Config.Storage, time.Now().Add(8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	token, csrf := sessionFor(t, s, owner)
	code, _ := call(t, server, token, csrf, "POST", "/api/projects/"+p.ID+"/exports", map[string]any{"version": p.Version, "track": "fr", "quality": "low"})
	if code != 200 {
		t.Fatal(code)
	}
	media := &downloadedFixtureMedia{source: original}
	w := Worker{Store: s, Config: a.Config, Media: media}
	if _, err := w.Once(ctx); err != nil {
		t.Fatal(err)
	}
	jobs, _ := s.Jobs(ctx, owner, p.ID)
	if len(jobs) != 1 || jobs[0].State != "succeeded" || media.downloads != 1 {
		t.Fatal(jobs)
	}
	code, data := call(t, server, token, csrf, "GET", "/api/projects/"+p.ID+"/exports/"+jobs[0].ID, nil)
	if code != 200 || len(data) < 1000 {
		t.Fatal("restored export not downloadable", code, len(data))
	}
	got, _ := s.Get(ctx, owner, p.ID)
	if !reflect.DeepEqual(got.Segments, p.Segments) || got.Version != p.Version {
		t.Fatal("restoration changed text")
	}
}
