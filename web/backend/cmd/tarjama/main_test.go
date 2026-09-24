package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestMigrationNeedsOnlyDatabaseAndCanBeRepeated(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required: make web-test")
	}
	ctx := context.Background()
	db, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close(ctx)
	schema := fmt.Sprintf("cli_migrate_%d", time.Now().UnixNano())
	if _, err = db.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer db.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	// pgx accepts keyword/value parameters appended to its URL's query string.
	separator := "?"
	for _, ch := range dsn {
		if ch == '?' {
			separator = "&"
			break
		}
	}
	file := filepath.Join(t.TempDir(), "database_url")
	if err = os.WriteFile(file, []byte(dsn+separator+"search_path="+schema), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DATABASE_URL", "")
	t.Setenv("DATABASE_URL_FILE", file)
	t.Setenv("APP_MODE", "production")
	for _, key := range []string{"PUBLIC_ORIGIN", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "ENCRYPTION_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "MEDIA_TOKEN"} {
		t.Setenv(key, "")
		t.Setenv(key+"_FILE", "")
	}
	oldArgs := os.Args
	os.Args = []string{"tarjama", "migrate"}
	defer func() { os.Args = oldArgs }()
	for range 2 {
		if err = run(); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err = db.QueryRow(ctx, "SELECT count(*) FROM "+schema+".schema_migrations").Scan(&count); err != nil || count != 3 {
		t.Fatalf("migration not applied exactly once: count=%d err=%v", count, err)
	}
}
