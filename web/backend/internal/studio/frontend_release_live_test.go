//go:build preview_live

package studio

import (
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// A deployment check through the registered internal web connection, without
// credentials, user data, provider calls or access to the public/admin gateway.
func TestFrontendRelease(t *testing.T) {
	if os.Getenv("PREVIEW_LIVE") != "atelier" {
		t.Fatal("Explicit atelier qualification job required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	get := func(path string) (int, []byte, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", "http://web:8080"+path, nil)
		if err != nil {
			return 0, nil, err
		}
		r, err := client.Do(req)
		if err != nil {
			return 0, nil, err
		}
		defer r.Body.Close()
		body, err := io.ReadAll(io.LimitReader(r.Body, 2*1024*1024))
		return r.StatusCode, body, err
	}
	for {
		status, _, err := get("/readyz")
		if err == nil && status == http.StatusNoContent {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("Readiness deadline exceeded")
		}
		time.Sleep(time.Second)
	}
	status, _, err := get("/api/projects")
	if err != nil || status != http.StatusUnauthorized {
		t.Fatal("Anonymous projects must be refused")
	}
	status, index, err := get("/")
	if err != nil || status != http.StatusOK {
		t.Fatal("Frontend unavailable")
	}
	for _, kind := range []string{"CSS", "JS"} {
		path, want := os.Getenv("EXPECTED_"+kind+"_PATH"), os.Getenv("EXPECTED_"+kind+"_SHA256")
		if !strings.HasPrefix(path, "/assets/") || strings.Contains(path, "..") || strings.ContainsAny(path, "?#") || len(want) != 64 {
			t.Fatal("Expected asset path and SHA256 required")
		}
		if !strings.Contains(string(index), path) {
			t.Fatalf("Index does not reference expected %s", kind)
		}
		status, body, err := get(path)
		if err != nil || status != http.StatusOK || fmt.Sprintf("%x", sha256.Sum256(body)) != want {
			t.Fatalf("Served %s differs from tested build", kind)
		}
		t.Logf("%s served with expected SHA256 %s", kind, want)
	}
}
