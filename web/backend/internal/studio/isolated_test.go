package studio

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// Protocol fixture, not an infrastructure qualification. The real broker's
// credential and runtime are deliberately never used by this suite.
type testOperation struct {
	request               operationRequest
	id, state             string
	inputs                map[string][]byte
	output                []byte
	starts, acks, cancels int
}
type testBroker struct {
	t                                                    *testing.T
	mu                                                   sync.Mutex
	jobs                                                 map[string]*testOperation
	keys                                                 map[string]string
	client                                               *IsolatedClient
	server                                               *httptest.Server
	loseCreate, loseUpload, breakOutput, badDigest, hold bool
	ranges                                               int
	execute                                              func(*testOperation) []byte
	beforeOutput                                         func()
	beforeAck                                            func(*testOperation)
}

func newTestBroker(t *testing.T) *testBroker {
	b := &testBroker{t: t, jobs: map[string]*testOperation{}, keys: map[string]string{}}
	b.server = httptest.NewTLSServer(http.HandlerFunc(b.serve))
	t.Cleanup(b.server.Close)
	ca := filepath.Join(t.TempDir(), "ca.crt")
	if e := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: b.server.Certificate().Raw}), 0600); e != nil {
		t.Fatal(e)
	}
	var e error
	b.client, e = NewIsolatedClient(b.server.URL, strings.Repeat("fixture-token", 4), ca)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func digest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func (b *testBroker) serve(w http.ResponseWriter, r *http.Request) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if r.Header.Get("Authorization") != "Bearer "+b.client.Token {
		http.Error(w, "denied", 401)
		return
	}
	if r.URL.Path == "/v1/jobs" && r.Method == "POST" {
		var p operationRequest
		if json.NewDecoder(r.Body).Decode(&p) != nil {
			http.Error(w, "invalid", 400)
			return
		}
		op := b.jobs[b.keys[p.Key]]
		if op == nil {
			op = &testOperation{request: p, id: id(), state: "staging", inputs: map[string][]byte{}, output: []byte("synthetic-output")}
			b.jobs[op.id] = op
			b.keys[p.Key] = op.id
		}
		if b.loseCreate {
			b.loseCreate = false
			http.Error(w, "lost response", 503)
			return
		}
		jsonOut(w, remoteOperation{ID: op.id, State: op.state})
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/v1/jobs/"), "/")
	op := b.jobs[parts[0]]
	if op == nil {
		http.NotFound(w, r)
		return
	}
	if len(parts) == 1 {
		jsonOut(w, remoteOperation{ID: op.id, State: op.state})
		return
	}
	switch parts[1] {
	case "inputs":
		if r.ContentLength <= 0 || len(parts) != 3 {
			http.Error(w, "invalid transfer", 400)
			return
		}
		raw, e := io.ReadAll(r.Body)
		if e != nil || int64(len(raw)) != r.ContentLength || digest(raw) != r.Header.Get("X-Content-SHA256") {
			http.Error(w, "invalid hash", 400)
			return
		}
		op.inputs[parts[2]] = raw
		if b.loseUpload {
			b.loseUpload = false
			http.Error(w, "lost upload response", 503)
			return
		}
		w.WriteHeader(204)
	case "start":
		if op.state == "staging" {
			op.starts++
			op.state = "succeeded"
			if b.hold {
				op.state = "running"
			} else if b.execute != nil {
				op.output = b.execute(op)
			}
		}
		w.WriteHeader(202)
	case "cancel":
		op.cancels++
		op.state = "cancelling"
		w.WriteHeader(202)
	case "ack":
		if !remoteTerminal(op.state) {
			b.t.Error("ACK before terminal state")
			http.Error(w, "not terminal", 409)
			return
		}
		if b.beforeAck != nil {
			b.beforeAck(op)
		}
		op.acks++
		op.state = "acknowledged"
		w.WriteHeader(204)
	case "outputs":
		if b.beforeOutput != nil {
			f := b.beforeOutput
			b.beforeOutput = nil
			f()
		}
		offset := 0
		if v := r.Header.Get("Range"); v != "" {
			b.ranges++
			fmt.Sscanf(v, "bytes=%d-", &offset)
		}
		if offset > len(op.output) {
			w.WriteHeader(416)
			return
		}
		hash := digest(op.output)
		if b.badDigest {
			hash = strings.Repeat("0", 64)
		}
		w.Header().Set("X-Content-SHA256", hash)
		w.Header().Set("ETag", `"`+hash+`"`)
		w.Header().Set("Content-Length", strconv.Itoa(len(op.output)-offset))
		if offset > 0 {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", offset, len(op.output)-1, len(op.output)))
			w.WriteHeader(206)
		}
		data := op.output[offset:]
		if b.breakOutput {
			b.breakOutput = false
			data = data[:len(data)/2]
		}
		w.Write(data)
	default:
		http.NotFound(w, r)
	}
}
func isolatedFixture(t *testing.T, b *testBroker) *IsolatedMedia {
	s := testStore(t)
	owner, p := fixture(t, s)
	ctx := context.Background()
	_, e := s.Mutate(ctx, owner, p.ID, func(p *Project, tx pgx.Tx) error { return enqueue(ctx, tx, owner, *p, "prepare") })
	if e != nil {
		t.Fatal(e)
	}
	j, e := s.Claim(ctx)
	if e != nil {
		t.Fatal(e)
	}
	return &IsolatedMedia{Store: s, Client: b.client, Storage: t.TempDir(), Job: j, Unit: -1, Poll: time.Millisecond}
}
func testInput(t *testing.T, m *IsolatedMedia) string {
	p := filepath.Join(m.Storage, "input")
	if e := os.WriteFile(p, []byte("fixture media"), 0600); e != nil {
		t.Fatal(e)
	}
	return p
}
func operate(m *IsolatedMedia, ctx context.Context, input string) (string, error) {
	return m.operation(ctx, "test", "media-probe", map[string]string{}, map[string]string{"media": input}, "stdout", 1024*1024)
}
func reclaim(t *testing.T, m *IsolatedMedia) *IsolatedMedia {
	ctx := context.Background()
	if _, e := m.Store.DB.Exec(ctx, "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1", m.Job.ID); e != nil {
		t.Fatal(e)
	}
	j, e := m.Store.Claim(ctx)
	if e != nil {
		t.Fatal(e)
	}
	n := *m
	n.Job = j
	return &n
}
func TestIsolatedRestartDuringCreateUploadAndDownload(t *testing.T) {
	for _, failure := range []string{"create", "upload", "output"} {
		t.Run(failure, func(t *testing.T) {
			b := newTestBroker(t)
			m := isolatedFixture(t, b)
			input := testInput(t, m)
			b.loseCreate = failure == "create"
			b.loseUpload = failure == "upload"
			b.breakOutput = failure == "output"
			b.beforeAck = func(op *testOperation) {
				var cached bool
				if e := m.Store.DB.QueryRow(context.Background(), "SELECT cached FROM media_operations WHERE key=$1", op.request.Key).Scan(&cached); e != nil || !cached {
					t.Error("ACK preceded durable database checkpoint", e)
				}
			}
			if _, e := operate(m, context.Background(), input); e == nil {
				t.Fatal("failure not exercised")
			}
			m = reclaim(t, m)
			path, e := operate(m, context.Background(), input)
			if e != nil {
				t.Fatal(e)
			}
			raw, e := os.ReadFile(path)
			if e != nil || string(raw) != "synthetic-output" {
				t.Fatal(string(raw), e)
			}
			b.mu.Lock()
			defer b.mu.Unlock()
			if len(b.jobs) != 1 {
				t.Fatal("duplicate operation", len(b.jobs))
			}
			for _, op := range b.jobs {
				if op.starts != 1 || op.acks != 1 {
					t.Fatal("duplicate execution or missing ACK", op.starts, op.acks)
				}
			}
			if failure == "output" && b.ranges != 1 {
				t.Fatal("partial download not resumed")
			}
		})
	}
}
func TestIsolatedRejectsTamperingAndChangedInputs(t *testing.T) {
	b := newTestBroker(t)
	m := isolatedFixture(t, b)
	input := testInput(t, m)
	b.badDigest = true
	if _, e := operate(m, context.Background(), input); e == nil {
		t.Fatal("bad hash accepted")
	}
	var cached bool
	m.Store.DB.QueryRow(context.Background(), "SELECT cached FROM media_operations").Scan(&cached)
	if cached {
		t.Fatal("bad result published")
	}
	if e := os.WriteFile(input, []byte("different input"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := operate(m, context.Background(), input); e == nil {
		t.Fatal("input changed under same key")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, op := range b.jobs {
		if op.acks != 0 {
			t.Fatal("corrupt result ACKed")
		}
	}
}
func TestIsolatedStaleResultCannotPublish(t *testing.T) {
	b := newTestBroker(t)
	m := isolatedFixture(t, b)
	input := testInput(t, m)
	b.beforeOutput = func() {
		_, e := m.Store.Mutate(context.Background(), m.Job.Owner, m.Job.ProjectID, func(p *Project, _ pgx.Tx) error { p.Generation++; return nil })
		if e != nil {
			t.Error(e)
		}
	}
	if _, e := operate(m, context.Background(), input); e == nil {
		t.Fatal("stale output accepted")
	}
	var cached bool
	m.Store.DB.QueryRow(context.Background(), "SELECT cached FROM media_operations").Scan(&cached)
	if cached {
		t.Fatal("stale cache committed")
	}
	if e := m.Reconcile(context.Background()); e != nil {
		t.Fatal(e)
	}
	var retired bool
	m.Store.DB.QueryRow(context.Background(), "SELECT retired FROM media_operations").Scan(&retired)
	if !retired {
		t.Fatal("stale successful output not cleaned")
	}
}

func TestIsolatedLeaseHandoverDoesNotCancelNewOwner(t *testing.T) {
	b := newTestBroker(t)
	m := isolatedFixture(t, b)
	input := testInput(t, m)
	var next *IsolatedMedia
	b.beforeOutput = func() { next = reclaim(t, m) }
	if _, e := operate(m, context.Background(), input); e == nil {
		t.Fatal("old lease published")
	}
	if e := m.Reconcile(context.Background()); e != nil {
		t.Fatal(e)
	}
	if _, e := operate(next, context.Background(), input); e != nil {
		t.Fatal(e)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, op := range b.jobs {
		if op.cancels != 0 || op.starts != 1 {
			t.Fatal("handover cancelled or duplicated operation", op.cancels, op.starts)
		}
	}
}

func TestIsolatedExpiredOutputNeedsExplicitRetry(t *testing.T) {
	b := newTestBroker(t)
	m := isolatedFixture(t, b)
	input := testInput(t, m)
	b.breakOutput = true
	if _, e := operate(m, context.Background(), input); e == nil {
		t.Fatal("transfer interruption missing")
	}
	b.mu.Lock()
	for _, op := range b.jobs {
		op.state = "expired"
	}
	b.mu.Unlock()
	m = reclaim(t, m)
	if _, e := operate(m, context.Background(), input); e == nil {
		t.Fatal("expired result accepted")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.jobs) != 1 {
		t.Fatal("expired operation silently recreated")
	}
	for _, op := range b.jobs {
		if op.starts != 1 {
			t.Fatal("expired operation restarted")
		}
	}
}
func TestIsolatedDeletionCancelsAndWaitsForTerminal(t *testing.T) {
	b := newTestBroker(t)
	m := isolatedFixture(t, b)
	input := testInput(t, m)
	b.hold = true
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if _, e := operate(m, ctx, input); e == nil {
		t.Fatal("operation should still be running")
	}
	if _, e := m.Store.DB.Exec(context.Background(), "DELETE FROM projects WHERE id=$1", m.Job.ProjectID); e != nil {
		t.Fatal(e)
	}
	if e := m.Reconcile(context.Background()); e != nil {
		t.Fatal(e)
	}
	b.mu.Lock()
	for _, op := range b.jobs {
		if op.cancels != 1 || op.acks != 0 {
			t.Error("cancel not awaited")
		}
		op.state = "cancelled"
	}
	b.mu.Unlock()
	if e := m.Reconcile(context.Background()); e != nil {
		t.Fatal(e)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, op := range b.jobs {
		if op.acks != 1 {
			t.Fatal("terminal cancellation not acknowledged")
		}
	}
}
func TestIsolatedRetryUsesNewKeyAndCacheLossDoesNotRerun(t *testing.T) {
	b := newTestBroker(t)
	m := isolatedFixture(t, b)
	input := testInput(t, m)
	path, e := operate(m, context.Background(), input)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.Remove(path); e != nil {
		t.Fatal(e)
	}
	m = reclaim(t, m)
	if _, e = operate(m, context.Background(), input); e == nil {
		t.Fatal("cache loss silently rerun")
	}
	m.Store.Fail(context.Background(), m.Job, fmt.Errorf("fixture failure"))
	if _, e = m.Store.DB.Exec(context.Background(), "UPDATE jobs SET progress=66 WHERE id=$1", m.Job.ID); e != nil {
		t.Fatal(e)
	}
	_, server := testAPI(t, m.Store)
	token, csrf := sessionFor(t, m.Store, m.Job.Owner)
	status, _ := call(t, server, token, csrf, "POST", "/api/projects/"+m.Job.ProjectID+"/jobs/"+m.Job.ID+"/retry", nil)
	if status != 204 {
		t.Fatal(status)
	}
	jobs, e := m.Store.Jobs(context.Background(), m.Job.Owner, m.Job.ProjectID)
	if e != nil || jobs[0].Progress != 0 {
		t.Fatal("explicit retry kept progress from old media attempt", jobs, e)
	}
	j, e := m.Store.Claim(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	m.Job = j
	if _, e = operate(m, context.Background(), input); e != nil {
		t.Fatal(e)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.jobs) != 2 {
		t.Fatal("explicit retry reused acknowledged operation")
	}
}
func TestIsolatedTLSAndRedirectRefusal(t *testing.T) {
	b := newTestBroker(t)
	if _, e := NewIsolatedClient("http://127.0.0.1", b.client.Token, "unused"); e == nil {
		t.Fatal("HTTP allowed")
	}
	wrong, e := NewIsolatedClient(b.server.URL, b.client.Token, "/etc/ssl/certs/ca-certificates.crt")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = wrong.create(context.Background(), operationRequest{Key: "test", Profile: "media-probe"}); e == nil {
		t.Fatal("untrusted CA accepted")
	}
	var leaked bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaked = true }))
	defer target.Close()
	redirect := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer redirect.Close()
	b.client.URL = redirect.URL
	if _, e := b.client.create(context.Background(), operationRequest{Key: "test", Profile: "media-probe"}); e == nil {
		t.Fatal("redirect accepted")
	}
	if leaked {
		t.Fatal("credential leaked through redirect")
	}
}
func TestIsolatedToolContracts(t *testing.T) {
	for _, args := range [][]string{{"audio", "-1", "100"}, {"audio", "0", "600001"}, {"audio", "1.25", "1000"}, {"export", "480;id", "270", "low"}, {"normalize", "481", "270", "high"}, {"download", "https://127.0.0.1/", "video"}, {"download", "https://www.youtube.com/watch?v=abcdefghijk", "--exec"}} {
		if _, _, _, _, _, e := isolatedToolCommand(args, "/inputs", "/outputs"); e == nil {
			t.Fatalf("invalid arguments allowed: %q", args)
		}
	}
	_, args, _, _, _, e := isolatedToolCommand([]string{"audio", "1234", "2345"}, "/inputs", "/outputs")
	if e != nil || !strings.Contains(strings.Join(args, " "), "-ss 1.234 -t 2.345") {
		t.Fatal("fractional offsets lost", args, e)
	}
	_, args, _, _, _, e = isolatedToolCommand([]string{"download", "https://www.youtube.com/watch?v=abcdefghijk", "video"}, "/inputs", "/outputs")
	joined := strings.Join(args, " ")
	if e != nil || !strings.Contains(joined, "--proxy http://127.0.0.1:18080") || !strings.Contains(joined, "--fixup never --ffmpeg-location /nonexistent") {
		t.Fatal("online FFmpeg or uncontrolled proxy", joined, e)
	}
}
func TestMediaStageProgressIsDurableAndLeaseFenced(t *testing.T) {
	b := newTestBroker(t)
	m := isolatedFixture(t, b)
	m.Job.Kind = "download"
	ctx := context.Background()
	if _, e := m.Store.DB.Exec(ctx, "UPDATE jobs SET kind='download' WHERE id=$1", m.Job.ID); e != nil {
		t.Fatal(e)
	}
	input := testInput(t, m)
	if _, e := m.operation(ctx, "download-video", "media-probe", map[string]string{}, map[string]string{"media": input}, "stdout", 1024); e != nil {
		t.Fatal(e)
	}
	jobs, e := m.Store.Jobs(ctx, m.Job.Owner, m.Job.ProjectID)
	if e != nil || len(jobs) != 1 || jobs[0].Progress != 16 {
		t.Fatal("completed stage not reported", jobs, e)
	}
	if e := m.reportProgress(ctx, "download-audio", false); e != nil {
		t.Fatal(e)
	}
	n := reclaim(t, m)
	if e := m.reportProgress(ctx, "mux", true); e != ErrConflict {
		t.Fatal("stale worker changed progress", e)
	}
	if e := n.reportProgress(ctx, "mux", false); e != nil {
		t.Fatal(e)
	}
	// Replaying an already cached stage cannot regress the visible progress.
	if _, e := n.operation(ctx, "download-video", "media-probe", map[string]string{}, map[string]string{"media": input}, "stdout", 1024); e != nil {
		t.Fatal(e)
	}
	jobs, e = n.Store.Jobs(ctx, n.Job.Owner, n.Job.ProjectID)
	if e != nil || jobs[0].Progress != 33 || !strings.Contains(jobs[0].Message, "Assemblage") {
		t.Fatal("replay regressed progress", jobs, e)
	}
}

func TestIsolatedRealOfflinePipeline(t *testing.T) {
	b := newTestBroker(t)
	m := isolatedFixture(t, b)
	input := filepath.Join(m.Storage, "input.mp4")
	cmd := exec.Command("ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", input)
	if raw, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("fixture: %v %s", e, raw)
	}
	b.execute = func(op *testOperation) []byte {
		dir := t.TempDir()
		in, out := filepath.Join(dir, "in"), filepath.Join(dir, "out")
		os.Mkdir(in, 0700)
		os.Mkdir(out, 0700)
		for name, data := range op.inputs {
			if e := os.WriteFile(filepath.Join(in, name), data, 0600); e != nil {
				t.Error(e)
				return nil
			}
		}
		params := op.request.Params
		args := []string{}
		name := ""
		switch op.request.Profile {
		case "media-probe", "tarjama-probe-v1":
			args = []string{"probe"}
			name = "stdout"
		case "tarjama-audio-v1":
			args = []string{"audio", params["start_ms"], params["duration_ms"]}
			name = "audio.flac"
		case "tarjama-normalize-v1":
			args = []string{"normalize", params["width"], params["height"], params["quality"]}
			name = "result.mp4"
		case "tarjama-export-v1":
			args = []string{"export", params["width"], params["height"], params["quality"]}
			name = "result.mp4"
		default:
			t.Error("unexpected profile", op.request.Profile)
			return nil
		}
		if e := runIsolatedTool(context.Background(), args, in, out); e != nil {
			t.Error(e)
			return nil
		}
		data, e := os.ReadFile(filepath.Join(out, name))
		if e != nil {
			t.Error(e)
		}
		return data
	}
	ctx := context.Background()
	prepared := filepath.Join(m.Storage, "prepared.mp4")
	info, e := m.Process(ctx, MediaRequest{Operation: "prepare"}, input, prepared)
	if e != nil || info.Width != 160 || info.Height != 90 {
		t.Fatal(info, e)
	}
	// Separate units create separate operation chains while retaining precise source times.
	n := *m
	n.Unit = 0
	info, e = n.Process(ctx, MediaRequest{Operation: "audio", Start: .123, Duration: 1.234}, prepared, filepath.Join(m.Storage, "audio.flac"))
	if e != nil || info.ChunkDuration != 1.234 {
		t.Fatal(info, e)
	}
	for i, track := range []string{"ar", "fr"} {
		for k, quality := range []string{"low", "high"} {
			n.Unit = 1 + i*2 + k
			_, e = n.Process(ctx, MediaRequest{Operation: "export", Quality: quality, Track: track, Segments: m.Job.Input.Segments}, prepared, filepath.Join(m.Storage, track+quality+".mp4"))
			if e != nil {
				t.Fatal(track, quality, e)
			}
		}
	}
}
