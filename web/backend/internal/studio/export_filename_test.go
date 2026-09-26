package studio

import (
	"context"
	"io"
	"mime"
	"net/http"
	"os"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

func TestExportFilename(t *testing.T) {
	for _, tc := range []struct{ title, want string }{
		{"sirat un nabi épisode 4", "sirat_un_nabi_épisode_4.mp4"},
		{"سيرة النبي", "سيرة_النبي.mp4"},
		{" ../../a\\b\r\n\"c:<>?*| ", "a_b_c.mp4"},
		{"...", "Tarjama_Studio.mp4"}, {"CON", "CON_video.mp4"},
	} {
		got := exportFilename(tc.title)
		if got != tc.want {
			t.Fatalf("%q => %q, want %q", tc.title, got, tc.want)
		}
		header := mime.FormatMediaType("attachment", map[string]string{"filename": got})
		disposition, params, e := mime.ParseMediaType(header)
		if e != nil || disposition != "attachment" || params["filename"] != tc.want || strings.ContainsAny(header, "\r\n") {
			t.Fatal("invalid download header", header, e)
		}
	}
	long := exportFilename(strings.Repeat("éع", 200))
	if !utf8.ValidString(long) || len(long) > 184 || !strings.HasSuffix(long, ".mp4") {
		t.Fatal("invalid long filename", long)
	}
}

func TestExportDownloadUsesCurrentTitle(t *testing.T) {
	s := testStore(t)
	owner, p := fixture(t, s)
	other, _ := fixture(t, s)
	a, server := testAPI(t, s)
	ctx := context.Background()
	if _, e := s.Mutate(ctx, owner, p.ID, func(q *Project, tx pgx.Tx) error { return enqueue(ctx, tx, owner, *q, "export_fr_high") }); e != nil {
		t.Fatal(e)
	}
	jobs, e := s.Jobs(ctx, owner, p.ID)
	if e != nil || len(jobs) != 1 {
		t.Fatal(e, jobs)
	}
	job := jobs[0].ID
	if _, e = s.DB.Exec(ctx, "UPDATE jobs SET state='succeeded' WHERE id=$1", job); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(storagePath(a.Config.Storage, job+".mp4"), []byte("0123456789"), 0600); e != nil {
		t.Fatal(e)
	}
	token, _ := sessionFor(t, s, owner)
	url := server.URL + "/api/projects/" + p.ID + "/exports/" + job
	for _, title := range []string{"sirat un nabi épisode 4", "سيرة النبي — renommé"} {
		if _, e = s.Mutate(ctx, owner, p.ID, func(q *Project, _ pgx.Tx) error { q.Title = title; return nil }); e != nil {
			t.Fatal(e)
		}
		req, _ := http.NewRequest("GET", url, nil)
		req.AddCookie(&http.Cookie{Name: "tarjama_session", Value: token})
		req.Header.Set("Range", "bytes=3-5")
		resp, e := server.Client().Do(req)
		if e != nil {
			t.Fatal(e)
		}
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		disposition, params, e := mime.ParseMediaType(resp.Header.Get("Content-Disposition"))
		if resp.StatusCode != 206 || string(b) != "345" || e != nil || disposition != "attachment" || params["filename"] != exportFilename(title) {
			t.Fatal(resp.StatusCode, string(b), params, e)
		}
	}
	otherToken, _ := sessionFor(t, s, other)
	status, _ := call(t, server, otherToken, "", "GET", "/api/projects/"+p.ID+"/exports/"+job, nil)
	if status != 404 {
		t.Fatal("another user's export exposed", status)
	}
	if _, e = s.DB.Exec(ctx, "UPDATE jobs SET state='running' WHERE id=$1", job); e != nil {
		t.Fatal(e)
	}
	status, _ = call(t, server, token, "", "GET", "/api/projects/"+p.ID+"/exports/"+job, nil)
	if status != 404 {
		t.Fatal("unfinished export exposed", status)
	}
}
