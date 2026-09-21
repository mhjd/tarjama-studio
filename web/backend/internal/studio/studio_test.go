package studio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required: make web-test")
	}
	ctx := context.Background()
	admin, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	schema := "test_" + id()
	if _, e = admin.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	cfg, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	s := &Store{pool}
	if e = s.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { pool.Close(); admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); admin.Close() })
	return s
}
func fixture(t *testing.T, s *Store) (string, Project) {
	t.Helper()
	ctx := context.Background()
	owner, e := s.User(ctx, "test", id())
	if e != nil {
		t.Fatal(e)
	}
	p := Project{ID: id(), Title: "Projet test", Stage: "arabic", Version: 1, ArabicVersion: 1, Generation: 1, Segments: []Segment{{ID: "one", Start: 0, End: 2000, Arabic: "السلام عليكم", Version: 1}, {ID: "two", Start: 2000, End: 4000, Arabic: "مرحبا بكم", Version: 1}}}
	if e = s.Create(ctx, owner, p); e != nil {
		t.Fatal(e)
	}
	return owner, p
}
func testAPI(t *testing.T, s *Store) (*API, *httptest.Server) {
	t.Helper()
	c := Config{Mode: "test", Origin: "http://127.0.0.1:8090", Storage: t.TempDir(), EncryptionKey: make([]byte, 32)}
	a := &API{Store: s, Config: c, Auth: &Auth{Store: s, Config: c}}
	server := httptest.NewServer(a.Routes())
	t.Cleanup(server.Close)
	return a, server
}
func sessionFor(t *testing.T, s *Store, user string) (string, string) {
	t.Helper()
	token, csrf := id(), id()
	_, e := s.DB.Exec(context.Background(), "INSERT INTO sessions VALUES($1,$2,$3,now()+interval '1 hour')", hash(token), user, csrf)
	if e != nil {
		t.Fatal(e)
	}
	return token, csrf
}
func call(t *testing.T, server *httptest.Server, token, csrf, method, path string, body any) (int, []byte) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, server.URL+path, bytes.NewReader(b))
	req.Header.Set("Origin", "http://127.0.0.1:8090")
	req.Header.Set("X-CSRF-Token", csrf)
	req.AddCookie(&http.Cookie{Name: "tarjama_session", Value: token})
	r, e := server.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer r.Body.Close()
	data, _ := io.ReadAll(r.Body)
	return r.StatusCode, data
}
func TestTimeAndChunks(t *testing.T) {
	a, e := ParseTimecode("1:00:01.120")
	if e != nil || a != 3601120 {
		t.Fatal(a, e)
	}
	b, e := ParseTimecode("01:00:01.120")
	if e != nil || a != b {
		t.Fatal(b, e)
	}
	for _, v := range []string{"60:01.120", "00:60:01.120", "-1:00", "00:60"} {
		if _, e := ParseTimecode(v); e == nil {
			t.Fatal(v)
		}
	}
	s := []Segment{{Start: 0, End: 1000}, {Start: 1200000, End: 1201000}, {Start: 4000000, End: 4001000}}
	if len(TextChunks(s)) != 3 {
		t.Fatal("chunk boundaries")
	}
}
func TestPrivateResourcesAndCSRF(t *testing.T) {
	s := testStore(t)
	owner, p := fixture(t, s)
	other, _ := fixture(t, s)
	a, server := testAPI(t, s)
	token, csrf := sessionFor(t, s, other)
	ctx := context.Background()
	p.Media = id() + ".mp4"
	s.Mutate(ctx, owner, p.ID, func(q *Project, tx pgx.Tx) error { *q = p; return enqueue(ctx, tx, owner, p, "translate") })
	jobs, _ := s.Jobs(ctx, owner, p.ID)
	os.WriteFile(storagePath(a.Config.Storage, p.Media), []byte("0123456789"), 0600)
	paths := []struct {
		method, path string
		body         any
	}{{"GET", "/api/projects/" + p.ID, nil}, {"GET", "/api/projects/" + p.ID + "/media", nil}, {"PATCH", "/api/projects/" + p.ID + "/segments/one", map[string]any{"field": "arabic", "text": "س", "version": 1}}, {"POST", "/api/projects/" + p.ID + "/exports", map[string]any{"version": 1, "track": "ar", "quality": "low"}}, {"POST", "/api/projects/" + p.ID + "/jobs/" + jobs[0].ID + "/cancel", nil}, {"POST", "/api/projects/" + p.ID + "/jobs/" + jobs[0].ID + "/retry", nil}, {"GET", "/api/projects/" + p.ID + "/exports/" + jobs[0].ID, nil}, {"DELETE", "/api/projects/" + p.ID, nil}, {"PUT", "/api/projects/" + p.ID + "/media", nil}}
	for _, x := range paths {
		status, b := call(t, server, token, csrf, x.method, x.path, x.body)
		if status != 404 {
			t.Fatalf("%s %s: %d %s", x.method, x.path, status, b)
		}
	}
	token, csrf = sessionFor(t, s, owner)
	status, _ := call(t, server, token, "bad", "DELETE", "/api/projects/"+p.ID, nil)
	if status != 403 {
		t.Fatal("CSRF")
	}
	status, _ = call(t, server, "", "", "GET", "/api/projects/"+p.ID, nil)
	if status != 401 {
		t.Fatal("authentication")
	}
	req, _ := http.NewRequest("GET", server.URL+"/api/projects/"+p.ID+"/media", nil)
	req.AddCookie(&http.Cookie{Name: "tarjama_session", Value: token})
	req.Header.Set("Range", "bytes=3-5")
	resp, e := server.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 206 || string(b) != "345" {
		t.Fatal(resp.StatusCode, string(b))
	}
}
func TestEditsVersioningAndIdempotentAdvance(t *testing.T) {
	s := testStore(t)
	owner, p := fixture(t, s)
	_, server := testAPI(t, s)
	token, csrf := sessionFor(t, s, owner)
	path := "/api/projects/" + p.ID
	status, b := call(t, server, token, csrf, "PATCH", path+"/segments/one", map[string]any{"field": "arabic", "text": "السلام عليكم جميعا", "version": 1})
	if status != 200 {
		t.Fatal(status, string(b))
	}
	var updated Project
	json.Unmarshal(b, &updated)
	if updated.Version != 2 {
		t.Fatal(updated)
	}
	status, _ = call(t, server, token, csrf, "PATCH", path+"/segments/one", map[string]any{"field": "arabic", "text": "stale", "version": 1})
	if status != 409 {
		t.Fatal("lost update", status)
	}
	status, _ = call(t, server, token, csrf, "POST", path+"/advance", map[string]any{"version": 1, "stage": "arabic"})
	if status != 409 {
		t.Fatal("stale stage")
	}
	for i := 0; i < 2; i++ {
		status, b = call(t, server, token, csrf, "POST", path+"/advance", map[string]any{"version": 2, "stage": "arabic"})
		if status != 200 {
			t.Fatal(status, string(b))
		}
	}
	jobs, _ := s.Jobs(context.Background(), owner, p.ID)
	if len(jobs) != 1 {
		t.Fatal("duplicate stage", jobs)
	}
}
func TestKeysAuthenticatedEncryption(t *testing.T) {
	s := testStore(t)
	owner, _ := fixture(t, s)
	other, _ := fixture(t, s)
	a, server := testAPI(t, s)
	c := a.Config
	c.GeminiKey = "shared"
	ctx := context.Background()
	if e := s.SetKey(ctx, c, owner, "gemini", "personal-sensitive"); e != nil {
		t.Fatal(e)
	}
	v, _, e := s.Key(ctx, c, owner, "gemini")
	if e != nil || v != "personal-sensitive" {
		t.Fatal(v, e)
	}
	v, _, e = s.Key(ctx, c, other, "gemini")
	if e != nil || v != "shared" {
		t.Fatal(v, e)
	}
	var encrypted []byte
	s.DB.QueryRow(ctx, "SELECT ciphertext FROM credentials WHERE owner_id=$1", owner).Scan(&encrypted)
	if bytes.Contains(encrypted, []byte("personal-sensitive")) {
		t.Fatal("plaintext")
	}
	if _, e = unseal(c.EncryptionKey, other, "gemini", encrypted); e == nil {
		t.Fatal("owner binding")
	}
	encrypted[len(encrypted)-1] ^= 1
	if _, e = unseal(c.EncryptionKey, owner, "gemini", encrypted); e == nil {
		t.Fatal("tampering")
	}
	token, csrf := sessionFor(t, s, owner)
	_, body := call(t, server, token, csrf, "GET", "/api/credentials", nil)
	if bytes.Contains(body, []byte("personal")) {
		t.Fatal("read-only secret exposure")
	}
	s.SetKey(ctx, c, owner, "gemini", "replacement")
	v, _, _ = s.Key(ctx, c, owner, "gemini")
	if v != "replacement" {
		t.Fatal(v)
	}
	s.SetKey(ctx, c, owner, "gemini", "")
	v, _, _ = s.Key(ctx, c, owner, "gemini")
	if v != "shared" {
		t.Fatal(v)
	}
}
func TestLeaseCrashFairnessAndLateResults(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, p := fixture(t, s)
	other, q := fixture(t, s)
	for _, x := range []struct {
		o string
		p Project
	}{{owner, p}, {other, q}} {
		_, e := s.Mutate(ctx, x.o, x.p.ID, func(p *Project, tx pgx.Tx) error { return enqueue(ctx, tx, x.o, *p, "translate") })
		if e != nil {
			t.Fatal(e)
		}
	}
	j, e := s.Claim(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Chunk(ctx, j, 0, map[string]any{"ok": true}, GeminiModel, "v1", 40); e != nil {
		t.Fatal(e)
	}
	next, e := s.Claim(ctx)
	if e != nil || next.Owner == j.Owner {
		t.Fatal("fairness", e)
	}
	s.DB.Exec(ctx, "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1", next.ID)
	reclaimed, e := s.Claim(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if reclaimed.ID != j.ID { // user fairness may reclaim the other job first, both must reject old token
		if reclaimed.Lease == next.Lease {
			t.Fatal("lease reuse")
		}
	}
	if e = s.Finish(ctx, next, func(*Project) error { return nil }, ""); !errors.Is(e, ErrConflict) {
		t.Fatal("late lease", e)
	}
	saved, _ := s.Chunks(ctx, j)
	if len(saved) != 1 {
		t.Fatal("lost completed chunk")
	}
	s.DB.Exec(ctx, "DELETE FROM projects WHERE id=$1", reclaimed.ProjectID)
	if e = s.Finish(ctx, reclaimed, func(*Project) error { return nil }, ""); !errors.Is(e, ErrMissing) {
		t.Fatal("resurrection", e)
	}
}
func TestUploadReplacesDownloadGeneration(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, p := fixture(t, s)
	p.Segments = []Segment{}
	p.Stage = "preparing"
	_, e := s.Mutate(ctx, owner, p.ID, func(q *Project, tx pgx.Tx) error { *q = p; return enqueue(ctx, tx, owner, p, "download") })
	if e != nil {
		t.Fatal(e)
	}
	j, e := s.Claim(ctx)
	if e != nil {
		t.Fatal(e)
	}
	_, server := testAPI(t, s)
	token, csrf := sessionFor(t, s, owner)
	status, b := call(t, server, token, csrf, "PUT", "/api/projects/"+p.ID+"/media", strings.Repeat("media", 100))
	if status != 200 {
		t.Fatal(status, string(b))
	}
	if e = s.Finish(ctx, j, func(p *Project) error { p.Media = "late"; return nil }, "transcribe"); !errors.Is(e, ErrConflict) {
		t.Fatal("late download accepted", e)
	}
	jobs, _ := s.Jobs(ctx, owner, p.ID)
	if len(jobs) != 2 || jobs[0].State != "cancelled" || jobs[1].Kind != "prepare" {
		t.Fatal(jobs)
	}
}
func TestResponseValidation(t *testing.T) {
	s := []Segment{{ID: "a"}, {ID: "b"}}
	for _, raw := range []string{`{"segments":[{"id":"a","text":"oui"}]}`, `{"segments":[{"id":"a","text":"oui"},{"id":"a","text":"oui"}]}`, `{"segments":[{"id":"b","text":"oui"},{"id":"a","text":"oui"}]}`, `{"segments":[{"id":"a","text":""},{"id":"b","text":"oui"}]}`} {
		var r TextResult
		json.Unmarshal([]byte(raw), &r)
		if ValidateText(r, s) == nil {
			t.Fatal(raw)
		}
	}
}
func TestProviderStatusesAndSecretPlacement(t *testing.T) {
	for _, status := range []int{401, 403, 404, 429, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.Contains(r.URL.String(), "sensitive") || r.Header.Get("x-goog-api-key") != "sensitive" {
					t.Error("secret placement")
				}
				w.Header().Set("Retry-After", "3600")
				w.WriteHeader(status)
				w.Write([]byte(`{"error":"secret-sensitive"}`))
			}))
			defer server.Close()
			p := NewProviders()
			p.GeminiURL = server.URL
			_, e := p.Text(context.Background(), "sensitive", "translate", []Segment{{ID: "a", Arabic: "سلام"}}, nil)
			var pe *ProviderError
			if !errors.As(e, &pe) || pe.Temporary != (status == 429 || status == 503) || strings.Contains(pe.Public, "sensitive") {
				t.Fatal(e)
			}
			if pe.After != time.Hour {
				t.Fatal(pe.After)
			}
		})
	}
}
func TestSSRFAndWARPFailClosed(t *testing.T) {
	for _, v := range []string{"https://127.0.0.1/x", "https://[::1]/", "https://youtube.com.evil.test/watch?v=abcdefghijk", "https://user@youtube.com/watch?v=abcdefghijk", "https://youtube.com:443/watch?v=abcdefghijk", "--exec=bad"} {
		if _, e := VideoURL(v); e == nil {
			t.Fatal(v)
		}
	}
	for _, ip := range []string{"127.0.0.1", "::1", "::ffff:127.0.0.1", "10.1.1.1", "169.254.169.254", "fd00::1", "100.100.100.200", "64:ff9b::7f00:1"} {
		if PublicIP(netip.MustParseAddr(ip)) {
			t.Fatal(ip)
		}
	}
	calls := 0
	proxy := &Egress{Warp: "warp:40000", Lookup: func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
	}, Dial: func(context.Context, string, string) (net.Conn, error) { calls++; return nil, errors.New("off") }}
	r := httptest.NewRequest("CONNECT", "https://rr.googlevideo.com", nil)
	r.Host = "rr.googlevideo.com:443"
	w := httptest.NewRecorder()
	proxy.ServeHTTP(w, r)
	if w.Code != 403 || calls != 0 {
		t.Fatal("private subrequest", w.Code)
	}
	proxy.Lookup = func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("8.8.8.8")}, nil
	}
	w = httptest.NewRecorder()
	proxy.ServeHTTP(w, r)
	if w.Code != 503 || calls != 1 {
		t.Fatal("fallback to direct", w.Code, calls)
	}
}
func TestRealMediaAndExports(t *testing.T) {
	if _, e := exec.LookPath("ffmpeg"); e != nil {
		t.Skip("ffmpeg required")
	}
	ctx := context.Background()
	dir := t.TempDir()
	source := filepath.Join(dir, "source.mp4")
	cmd := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=0x31453b:s=320x480:d=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", source)
	if out, e := cmd.CombinedOutput(); e != nil {
		t.Fatal(e, string(out))
	}
	m := LocalMedia{Test: true}
	for _, track := range []string{"ar", "fr"} {
		for _, quality := range []string{"low", "high"} {
			output := filepath.Join(dir, track+quality+".mp4")
			info, e := m.Process(ctx, MediaRequest{Operation: "export", Track: track, Quality: quality, Segments: []Segment{{ID: "a", Start: 0, End: 2500, Arabic: "السَّلَامُ عَلَيْكُمْ ١٢٣", French: "Bonjour à tous, été 2026."}}}, source, output)
			if e != nil {
				t.Fatal(e)
			}
			if info.Width != 320 || info.Height != 480 {
				t.Fatal("upscale/orientation", info)
			}
			if dest := os.Getenv("MEDIA_TEST_ARTIFACTS"); dest != "" {
				os.MkdirAll(dest, 0700)
				b, _ := os.ReadFile(output)
				os.WriteFile(filepath.Join(dest, track+quality+".mp4"), b, 0600)
			}
		}
	}
	audio := filepath.Join(dir, "audio")
	info, e := m.Process(ctx, MediaRequest{Operation: "audio", Start: 0, Duration: 3}, source, audio)
	if e != nil || info.ChunkDuration != 3 {
		t.Fatal(info, e)
	}
	mute := filepath.Join(dir, "mute.mp4")
	if out, e := exec.Command("ffmpeg", "-v", "error", "-i", source, "-an", "-c:v", "copy", mute).CombinedOutput(); e != nil {
		t.Fatal(e, string(out))
	}
	if _, e = m.Process(ctx, MediaRequest{Operation: "prepare"}, mute, filepath.Join(dir, "rejected")); e == nil {
		t.Fatal("video without audio accepted")
	}
}
func TestASRHourBoundary(t *testing.T) {
	chunks := []ASRChunk{{Start: 3580, Duration: 40, Response: ASRResponse{Segments: []ASRSegment{{Start: 0, End: 5, Text: "أول"}, {Start: 20, End: 28, Text: "ثاني"}}}}, {Start: 3600, Duration: 40, Response: ASRResponse{Segments: []ASRSegment{{Start: 0, End: 8, Text: "ثاني"}, {Start: 8, End: 15, Text: "ثالث"}}}}}
	out, e := MergeASR(chunks, 3640000)
	if e != nil || len(out) != 3 || out[1].Start != 3600000 || out[2].Start != 3608000 {
		t.Fatal(out, e)
	}
}
func TestImportCurrentAndSeparateTranslation(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) {
		if e := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); e != nil {
			t.Fatal(e)
		}
	}
	write("project.json", `{"title":"Test"}`)
	write("source.mp4", "fixture")
	write("transcript.json", `{"segments":[{"id":"1","start":3601.12,"end":3603,"text":"قديم"}]}`)
	write("current.json", `{"segments":[{"id":"1","start":3601.12,"end":3603,"text":"جديد"}]}`)
	write("translation.json", `{"segments":[{"id":"1","start":3601.120,"end":3603,"translation":"Nouveau"}]}`)
	bundle, e := ReadDesktop(dir)
	if e != nil || bundle.Project.Segments[0].Arabic != "جديد" || bundle.Project.Segments[0].French != "Nouveau" || bundle.Project.ConfirmedReview != 0 {
		t.Fatal(bundle, e)
	}
	write("translation.json", `{"segments":[{"id":"1","start":3601.121,"end":3603,"translation":"Nouveau"}]}`)
	if _, e = ReadDesktop(dir); e == nil {
		t.Fatal("timestamp mismatch")
	}
}

func TestRotationAndLandscape(t *testing.T) {
	if _, e := exec.LookPath("ffmpeg"); e != nil {
		t.Skip("ffmpeg required")
	}
	dir := t.TempDir()
	src := filepath.Join(dir, "landscape.mp4")
	rotated := filepath.Join(dir, "rotated.mp4")
	if out, e := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=s=640x360:d=1", "-f", "lavfi", "-i", "sine=duration=1", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", src).CombinedOutput(); e != nil {
		t.Fatal(e, string(out))
	}
	if out, e := exec.Command("ffmpeg", "-v", "error", "-i", src, "-c", "copy", "-metadata:s:v:0", "rotate=90", rotated).CombinedOutput(); e != nil {
		t.Fatal(e, string(out))
	}
	m := LocalMedia{Test: true}
	for i, input := range []string{src, rotated} {
		info, e := m.Process(context.Background(), MediaRequest{Operation: "prepare"}, input, filepath.Join(dir, fmt.Sprintf("out%d.mp4", i)))
		if e != nil {
			t.Fatal(e)
		}
		if i == 0 && (info.Width != 640 || info.Height != 360) {
			t.Fatal(info)
		}
		if i == 1 && (info.Width != 360 || info.Height != 640) {
			t.Fatal("rotation stretched", info)
		}
	}
}

func TestMediaRPCAndDesktopCopyImport(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, _ := fixture(t, s)
	dir := t.TempDir()
	storage := t.TempDir()
	source := filepath.Join(dir, "source.mp4")
	if out, e := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=s=160x120:d=2", "-f", "lavfi", "-i", "sine=duration=2", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", source).CombinedOutput(); e != nil {
		t.Fatal(e, string(out))
	}
	token := strings.Repeat("m", 32)
	server := httptest.NewServer(MediaHandler(LocalMedia{Test: true, ConsumeInput: true}, token))
	defer server.Close()
	client := RemoteMedia{URL: server.URL, Token: "bad", Client: server.Client()}
	if _, e := client.Process(ctx, MediaRequest{Operation: "prepare"}, source, filepath.Join(storage, "bad")); e == nil {
		t.Fatal("RPC token ignored")
	}
	client.Token = token
	info, e := client.Process(ctx, MediaRequest{Operation: "prepare"}, source, filepath.Join(storage, "valid"))
	if e != nil || info.Width != 160 {
		t.Fatal(info, e)
	}
	os.WriteFile(filepath.Join(dir, "project.json"), []byte(`{"title":"Copie desktop"}`), 0600)
	os.WriteFile(filepath.Join(dir, "current.json"), []byte(`{"segments":[{"id":"a","start":0,"end":1,"text":"سلام"}]}`), 0600)
	os.WriteFile(filepath.Join(dir, "translation.json"), []byte(`{"segments":[{"id":"a","start":0,"end":1,"translation":"Bonjour"}]}`), 0600)
	os.Mkdir(filepath.Join(dir, "snapshots"), 0700)
	snapshot := filepath.Join(dir, "snapshots", "immutable.json")
	os.WriteFile(snapshot, []byte("immutable"), 0600)
	c := Config{Storage: storage, MediaURL: server.URL, MediaToken: token}
	args := []string{"--bundle", dir, "--owner", owner}
	if e = ImportCommand(ctx, s, c, args); e != nil {
		t.Fatal(e)
	}
	before, _ := s.List(ctx, owner)
	if len(before) != 1 {
		t.Fatal("dry-run wrote data")
	}
	for i := 0; i < 2; i++ {
		if e = ImportCommand(ctx, s, c, append(args, "--apply")); e != nil {
			t.Fatal(e)
		}
	}
	projects, _ := s.List(ctx, owner)
	if len(projects) != 2 {
		t.Fatal("duplicate import", len(projects))
	}
	var imported Project
	for _, p := range projects {
		if p.Title == "Copie desktop" {
			imported, _ = s.Get(ctx, owner, p.ID)
		}
	}
	if imported.Stage != "arabic" || imported.ConfirmedArabic != 0 || imported.ConfirmedReview != 0 || imported.Segments[0].French != "Bonjour" {
		t.Fatal(imported)
	}
	jobs, _ := s.Jobs(ctx, owner, imported.ID)
	if len(jobs) != 0 {
		t.Fatal("import called providers")
	}
	b, _ := os.ReadFile(snapshot)
	if string(b) != "immutable" {
		t.Fatal("snapshot changed")
	}
	if _, e = os.Stat(source); e != nil {
		t.Fatal("desktop media moved")
	}
	_, api := testAPI(t, s)
	session, csrf := sessionFor(t, s, owner)
	status, _ := call(t, api, session, csrf, "POST", "/api/projects/"+imported.ID+"/advance", map[string]any{"version": 1, "stage": "arabic"})
	if status != 200 {
		t.Fatal(status)
	}
	jobs, _ = s.Jobs(ctx, owner, imported.ID)
	if len(jobs) != 0 {
		t.Fatal("revalidation retranslated imported text")
	}
	imported, _ = s.Get(ctx, owner, imported.ID)
	if imported.Stage != "review" {
		t.Fatal(imported)
	}
}
func TestMigrationRepeatAndReadiness(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if e := s.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if e := s.Ready(ctx); e != nil {
		t.Fatal(e)
	}
	var count int
	s.DB.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&count)
	if count != 1 {
		t.Fatal(count)
	}
}
