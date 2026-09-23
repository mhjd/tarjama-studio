// Read-only operational diagnosis. Never prints credentials, URLs or transcript text.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"tarjama/web/internal/studio"
	"time"
)

func secret(path string) string {
	b, e := os.ReadFile(path)
	if e != nil {
		panic("Required secret file unavailable")
	}
	return strings.TrimSpace(string(b))
}

var urls = regexp.MustCompile(`https?://[^\s"<>]+`)

func clean(s string) string {
	s = urls.ReplaceAllString(s, "[URL]")
	if len(s) > 2500 {
		s = s[len(s)-2500:]
	}
	return s
}
func main() {
	if e := run(); e != nil {
		fmt.Println("Diagnostic failed (details withheld)")
		os.Exit(1)
	}
}
func run() error {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cfg, e := pgxpool.ParseConfig(secret(os.Getenv("DATABASE_URL_FILE")))
	if e != nil {
		return e
	}
	cfg.ConnConfig.RuntimeParams["default_transaction_read_only"] = "on"
	cfg.ConnConfig.ConnectTimeout = 3 * time.Second
	db, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		return e
	}
	defer db.Close()
	for n := 0; n < 15; n++ {
		if e = db.Ping(ctx); e == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if e != nil {
		return e
	}
	c, e := studio.NewIsolatedClient(os.Getenv("VPS_JOBS_URL"), secret(os.Getenv("VPS_JOBS_TOKEN_FILE")), os.Getenv("VPS_JOBS_CA_FILE"))
	if e != nil {
		return e
	}
	c.HTTP.Timeout = 8 * time.Second
	get := func(path string, rangeProbe bool) (int, []byte) {
		req, _ := http.NewRequestWithContext(ctx, "GET", c.URL+path, nil)
		req.Header.Set("Authorization", "Bearer "+c.Token)
		if rangeProbe {
			req.Header.Set("Range", "bytes=0-0")
		}
		r, err := c.HTTP.Do(req)
		if err != nil {
			fmt.Printf("broker transport failure timeout=%t\n", os.IsTimeout(err))
			return 0, nil
		}
		defer r.Body.Close()
		limit := int64(32768)
		if rangeProbe {
			limit = 1
		}
		b, _ := io.ReadAll(io.LimitReader(r.Body, limit))
		return r.StatusCode, b
	}
	code, _ := get("/v1/profiles", false)
	fmt.Println("broker_profiles_http", code)
	rows, e := db.Query(ctx, `SELECT id,kind,state,progress,media_attempt,attempts,next_attempt_at::text FROM jobs WHERE kind='download' ORDER BY created_at DESC LIMIT 5`)
	if e != nil {
		return e
	}
	for rows.Next() {
		var id, kind, state, next string
		var progress, attempt, tries int
		if e = rows.Scan(&id, &kind, &state, &progress, &attempt, &tries, &next); e != nil {
			return e
		}
		fmt.Printf("job=%s kind=%s state=%s progress=%d media_attempt=%d tries=%d next=%s\n", id, kind, state, progress, attempt, tries, next)
	}
	rows.Close()
	rows, e = db.Query(ctx, `SELECT o.job_id,o.remote_id,o.unit,o.attempt,o.definition->'request'->>'profile',o.definition->>'output',o.cached,o.acknowledged,o.retired FROM media_operations o JOIN jobs j ON j.id=o.job_id WHERE j.id IN (SELECT id FROM jobs WHERE kind='download' ORDER BY created_at DESC LIMIT 3) ORDER BY o.updated_at DESC LIMIT 18`)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var job, id, profile, output string
		var unit, attempt int
		var cached, ack, retired bool
		if e = rows.Scan(&job, &id, &unit, &attempt, &profile, &output, &cached, &ack, &retired); e != nil {
			return e
		}
		fmt.Printf("operation job=%s id=%s unit=%d attempt=%d profile=%s cached=%t ack=%t retired=%t\n", job, id, unit, attempt, profile, cached, ack, retired)
		if id == "" {
			continue
		}
		code, b := get("/v1/jobs/"+id, false)
		var data map[string]any
		json.Unmarshal(b, &data)
		fmt.Printf("remote http=%d state=%v exit=%v error=%s\n", code, data["state"], data["exit_code"], clean(fmt.Sprint(data["error"])))
		if data["state"] == "failed" {
			code, b = get("/v1/jobs/"+id+"/diagnostics", false)
			fmt.Printf("diagnostics http=%d %s\n", code, clean(string(b)))
		}
		if data["state"] == "succeeded" && !cached {
			code, _ = get("/v1/jobs/"+id+"/outputs/"+output, true)
			fmt.Printf("output_probe http=%d\n", code)
		}
	}
	return rows.Err()
}
