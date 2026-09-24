package studio

import (
	"context"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplicationDeepLinksServeOnlyPublicShell(t *testing.T) {
	s := testStore(t)
	a, _ := testAPI(t, s)
	a.Config.Frontend = t.TempDir()
	const shell = "<!doctype html><div id=\"root\"></div>"
	if err := os.WriteFile(filepath.Join(a.Config.Frontend, "index.html"), []byte(shell), 0600); err != nil {
		t.Fatal(err)
	}
	h := a.Routes()
	for _, path := range []string{"/projets", "/projets/nouveau", "/projets/fixture", "/projets/fixture/corriger", "/projets/fixture/exporter", "/compte/cles"} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, path, nil))
		if rr.Code != 200 || rr.Body.String() != shell {
			t.Fatal(path, rr.Code, rr.Body.String())
		}
	}
	for _, path := range []string{"/assets/missing.js", "/api/projects/fixture", "/api/unknown", "/unknown"} {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, path, nil))
		if rr.Code == 200 || strings.Contains(rr.Body.String(), "id=\"root\"") {
			t.Fatal("SPA hid API/asset failure", path, rr.Code)
		}
	}
}
func TestRoutesCannotBypassWorkflowGuards(t *testing.T) {
	s := testStore(t)
	owner, p := fixture(t, s)
	_, server := testAPI(t, s)
	token, csrf := sessionFor(t, s, owner)
	for _, stage := range []string{"upload", "preparing", "transcribing", "cleaning", "arabic", "translating"} {
		_, err := s.Mutate(context.Background(), owner, p.ID, func(p *Project, tx pgx.Tx) error { p.Stage = stage; return nil })
		if err != nil {
			t.Fatal(err)
		}
		code, _ := call(t, server, token, csrf, "POST", "/api/projects/"+p.ID+"/advance", map[string]any{"stage": "review", "version": 1})
		if code != 409 {
			t.Fatal("skipped correction/translation", stage, code)
		}
		code, _ = call(t, server, token, csrf, "POST", "/api/projects/"+p.ID+"/exports", map[string]any{"track": "fr", "quality": "high", "version": 1})
		if code != 400 {
			t.Fatal("exported without review", stage, code)
		}
		after, err := s.Get(context.Background(), owner, p.ID)
		if err != nil || after.Stage != stage || after.Version != 1 {
			t.Fatal("GET-like navigation changed workflow", err)
		}
		jobs, err := s.Jobs(context.Background(), owner, p.ID)
		if err != nil || len(jobs) != 0 {
			t.Fatal("unauthorized task queued", err)
		}
	}
}
