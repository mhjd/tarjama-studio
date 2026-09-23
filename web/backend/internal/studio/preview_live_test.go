//go:build preview_live

package studio

// Explicit deployment qualification, excluded from normal builds/tests. Runs in
// a trusted, bounded job; tools still run only through the administered broker.
// No login bypass, real user records, provider response text or secret logging.
import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

//go:embed testdata/preview.mp4
var previewFixture []byte

type previewTransport struct{ t *testing.T }

func (p previewTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	response, err := http.DefaultTransport.RoundTrip(r)
	if err != nil {
		p.t.Log("Provider transport failed (no request headers logged)")
	} else {
		p.t.Logf("Provider %s HTTP %d", r.URL.Hostname(), response.StatusCode)
	}
	return response, err
}

func TestPreviewLive(t *testing.T) {
	if os.Getenv("PREVIEW_LIVE") != "atelier" {
		t.Fatal("Explicit atelier qualification job required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	t.Run("HTTPAndOIDCStart", func(t *testing.T) {
		client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		// A newly created pod may not have network connectivity yet. Poll actual
		// readiness with a deadline; this is not a sandbox/network-policy guarantee.
		startup, stop := context.WithTimeout(ctx, time.Minute)
		defer stop()
		for {
			req, _ := http.NewRequestWithContext(startup, "GET", "http://web:8080/readyz", nil)
			r, err := client.Do(req)
			if err == nil {
				r.Body.Close()
				if r.StatusCode == 204 {
					break
				}
			}
			if startup.Err() != nil {
				t.Fatalf("Readiness deadline: %v", err)
			}
			time.Sleep(time.Second)
		}
		for _, check := range []struct {
			path string
			code int
		}{{"/readyz", 204}, {"/", 200}, {"/api/projects", 401}, {"/auth/callback", 400}, {"/auth/login", 302}} {
			req, _ := http.NewRequestWithContext(ctx, "GET", "http://web:8080"+check.path, nil)
			r, err := client.Do(req)
			if err != nil {
				t.Fatalf("%s: service unreachable", check.path)
			}
			io.Copy(io.Discard, io.LimitReader(r.Body, 1024*1024))
			r.Body.Close()
			if r.StatusCode != check.code {
				t.Fatalf("%s: HTTP %d, expected %d", check.path, r.StatusCode, check.code)
			}
			if check.path == "/auth/login" {
				u, err := url.Parse(r.Header.Get("Location"))
				if err != nil || u.Scheme != "https" || u.Host != "auth.runagen.com" || u.Query().Get("code_challenge_method") != "S256" || u.Query().Get("client_id") != "preview-atelier-tarjama" || u.Query().Get("redirect_uri") != "https://atelier.preview.runagen.com/auth/callback" {
					t.Fatal("Incorrect OIDC authorization redirect")
				}
				valid := false
				for _, c := range r.Cookies() {
					if c.Name == "tarjama_login" {
						valid = c.Secure && c.HttpOnly && c.SameSite == http.SameSiteLaxMode
					}
				}
				if !valid {
					t.Fatal("Login cookie protection missing")
				}
			}
		}
	})
	t.Run("GatewayTLS", func(t *testing.T) {
		client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		u, _ := url.Parse("https://atelier.preview.runagen.com/")
		for hop := 0; hop < 5; hop++ {
			req, _ := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
			r, err := client.Do(req)
			if err != nil {
				t.Fatal("Private gateway HTTPS unavailable")
			}
			r.Body.Close()
			if r.StatusCode != 302 && r.StatusCode != 303 && r.StatusCode != 307 {
				t.Fatalf("Expected authentication redirect, got HTTP %d", r.StatusCode)
			}
			next, err := url.Parse(r.Header.Get("Location"))
			if err != nil {
				t.Fatal("Invalid gateway redirect")
			}
			u = u.ResolveReference(next)
			if u.Scheme != "https" || u.User != nil {
				t.Fatal("Insecure gateway redirect")
			}
			if u.Host == "auth.runagen.com" {
				return
			}
			if u.Host != "atelier.preview.runagen.com" {
				t.Fatal("Unexpected gateway identity host")
			}
			// The gateway may first redirect through its own OAuth start path.
			// Never log the query/state or cookies while following that path.
		}
		t.Fatal("Authentication redirect chain exceeded five hops")
	})
	providers := NewProviders()
	segments := []Segment{{ID: "preview-one", Start: 0, End: 2000, Arabic: "السلام عليكم", French: "Bonjour à tous."}}
	for _, kind := range []string{"cleanup", "translate"} {
		t.Run("Gemini/"+kind, func(t *testing.T) {
			providers.Client.Transport = previewTransport{t}
			if secret("GEMINI_API_KEY") == "" {
				t.Fatal("Gemini secret unavailable")
			}
			limited, stop := context.WithTimeout(ctx, 90*time.Second)
			defer stop()
			for attempt := 0; attempt < 3; attempt++ {
				_, err := providers.Text(limited, secret("GEMINI_API_KEY"), kind, segments, nil)
				if err == nil {
					return
				}
				var temporary *ProviderError
				if !errors.As(err, &temporary) || !temporary.Temporary || attempt == 2 {
					t.Fatal(err)
				}
				t.Log("Temporary provider refusal; bounded retry respecting Retry-After")
				select {
				case <-limited.Done():
					t.Fatal("Provider remained unavailable within qualification deadline")
				case <-time.After(max(5*time.Second, temporary.After)):
				}
			}
		})
	}

	t.Run("IsolatedMedia", func(t *testing.T) {
		client, err := NewIsolatedClient(os.Getenv("VPS_JOBS_URL"), secret("VPS_JOBS_TOKEN"), os.Getenv("VPS_JOBS_CA_FILE"))
		if err != nil {
			t.Fatal(err)
		}
		dsn, err := LoadDatabaseURL()
		if err != nil {
			t.Fatal(err)
		}
		// testStore creates and later drops only a random test_<id> schema.
		// Production worker and user data remain in public, never in this schema.
		t.Setenv("TEST_DATABASE_URL", dsn)
		m := isolatedFixture(t, &testBroker{client: client})
		m.Poll = time.Second
		root, err := os.MkdirTemp("/storage", "preview-check-")
		if err != nil {
			t.Fatal("Shared volume is not writable")
		}
		m.Storage = root
		t.Cleanup(func() { os.RemoveAll(root) })
		heartbeat, stop := context.WithCancel(ctx)
		done := make(chan struct{})
		go func() {
			defer close(done)
			ticker := time.NewTicker(20 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-heartbeat.Done():
					return
				case <-ticker.C:
					m.Store.Heartbeat(heartbeat, m.Job)
				}
			}
		}()
		t.Cleanup(func() {
			stop()
			<-done
			cleanup, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			// Retire test operations and await terminal cleanup before deleting the
			// test schema/cache. Never cancel jobs belonging to real users.
			if _, err := m.Store.DB.Exec(cleanup, "UPDATE jobs SET state='cancelled' WHERE id=$1", m.Job.ID); err != nil {
				t.Error("Test cleanup failed")
				return
			}
			for cleanup.Err() == nil {
				if err := m.Reconcile(cleanup); err != nil {
					t.Error("Operation cleanup failed")
					return
				}
				var pending int
				if err := m.Store.DB.QueryRow(cleanup, "SELECT count(*) FROM media_operations WHERE NOT retired").Scan(&pending); err != nil {
					t.Error("Cleanup status unavailable")
					return
				}
				if pending == 0 {
					return
				}
				time.Sleep(time.Second)
			}
			t.Error("Operation cleanup exceeded deadline")
		})
		input, prepared := filepath.Join(root, "input.mp4"), filepath.Join(root, "prepared.mp4")
		if err := os.WriteFile(input, previewFixture, 0600); err != nil {
			t.Fatal(err)
		}
		if !t.Run("PrepareAndDurableReplay", func(t *testing.T) {
			info, err := m.Process(ctx, MediaRequest{Operation: "prepare"}, input, prepared)
			if err != nil {
				t.Fatal(err)
			}
			if info.Width != 320 || info.Height != 480 {
				t.Fatal("Incorrect video dimensions")
			}
			// Repeat through a new orchestrator after ACK: same durable operations,
			// no additional broker execution or output download is needed.
			restarted := *m
			if _, err := restarted.Process(ctx, MediaRequest{Operation: "prepare"}, input, filepath.Join(root, "replayed.mp4")); err != nil {
				t.Fatal(err)
			}
		}) {
			return
		}
		t.Run("AudioAndGroq", func(t *testing.T) {
			providers.Client.Transport = previewTransport{t}
			n := *m
			n.Unit = 0
			audio := filepath.Join(root, "audio.flac")
			info, err := n.Process(ctx, MediaRequest{Operation: "audio", Start: .123, Duration: 1.234}, prepared, audio)
			if err != nil {
				t.Fatal(err)
			}
			if info.ChunkDuration != 1.234 {
				t.Fatal("Audio time boundaries changed")
			}
			if secret("GROQ_API_KEY") == "" {
				t.Fatal("Groq secret unavailable")
			}
			if _, _, err := providers.Audio(ctx, secret("GROQ_API_KEY"), audio); err != nil {
				t.Fatal(err)
			}
			t.Log("Synthetic tone accepted by Groq; this does not evaluate Arabic transcription quality")
		})
		for i, track := range []string{"ar", "fr"} {
			for k, quality := range []string{"low", "high"} {
				t.Run("Export/"+track+"/"+quality, func(t *testing.T) {
					n := *m
					n.Unit = 1 + i*2 + k
					_, err := n.Process(ctx, MediaRequest{Operation: "export", Track: track, Quality: quality, Segments: segments}, prepared, filepath.Join(root, track+quality+".mp4"))
					if err != nil {
						t.Fatal(err)
					}
				})
			}
		}
		t.Run("YouTubeViaWARP", func(t *testing.T) {
			n := *m
			n.Unit = 5
			limited, cancel := context.WithTimeout(ctx, 3*time.Minute)
			defer cancel()
			_, err := n.Process(limited, MediaRequest{Operation: "download", URL: "https://www.youtube.com/watch?v=jNQXAC9IVRw"}, "", filepath.Join(root, "youtube.mp4"))
			if err != nil {
				// Diagnostics are confined to this fixed public video; print only
				// recognized failure categories, never raw output or request headers.
				rows, queryErr := m.Store.DB.Query(ctx, "SELECT remote_id FROM media_operations WHERE unit=5 AND remote_id<>''")
				if queryErr == nil {
					var ids []string
					for rows.Next() {
						var id string
						if rows.Scan(&id) == nil {
							ids = append(ids, id)
						}
					}
					rows.Close()
					for _, id := range ids {
						path, e := operationPath(id)
						if e != nil {
							continue
						}
						r, e := client.do(ctx, "GET", path+"/diagnostics", nil, 0, nil)
						if e != nil {
							continue
						}
						b, _ := io.ReadAll(io.LimitReader(r.Body, 32768))
						r.Body.Close()
						for _, category := range []string{"Sign in to confirm", "403", "429", "ProxyError", "certificate verify failed", "Requested format is not available", "No supported JavaScript runtime", "denied", "timed out", "502", "503"} {
							if strings.Contains(string(b), category) {
								t.Log(fmt.Sprintf("YouTube diagnostic category: %s", category))
							}
						}
					}
				}
				t.Fatal(err)
			}
		})
	})
}
