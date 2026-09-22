package studio

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"
)

func TestDatabaseStartupIsBoundedAndRedacted(t *testing.T) {
	if _, err := OpenWhenReady(context.Background(), ""); err == nil {
		t.Fatal("unbounded wait accepted")
	}
	// A silent endpoint exercises a stalled connection, not merely DNS failure.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err = OpenWhenReady(ctx, "postgres://test:DO_NOT_PRINT@"+l.Addr().String()+"/test?sslmode=disable")
	if !errors.Is(err, context.DeadlineExceeded) || strings.Contains(err.Error(), "DO_NOT_PRINT") {
		t.Fatalf("deadline/redaction failed: %v", err)
	}
	if time.Since(start) > time.Second {
		t.Fatal("database connection exceeded deadline")
	}
}

func TestWorkerDoesNotRequireOIDCButAPIDoes(t *testing.T) {
	t.Setenv("APP_MODE", "production")
	t.Setenv("PUBLIC_ORIGIN", "https://atelier.preview.runagen.com")
	t.Setenv("DATABASE_URL", "postgres://fixture")
	t.Setenv("DATABASE_URL_FILE", "")
	t.Setenv("ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	t.Setenv("ENCRYPTION_KEY_FILE", "")
	for _, key := range []string{"OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_CLIENT_SECRET_FILE"} {
		t.Setenv(key, "")
	}
	if _, err := LoadWorkerConfig(); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadConfig(); err == nil {
		t.Fatal("API accepted missing OIDC")
	}
}
