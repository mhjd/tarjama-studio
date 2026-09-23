// Dedicated private UI qualification server. Never linked into the release binary.
// Only a separate test schema and directory are used. OIDC and live user data
// are deliberately absent; providers and the isolated media engine are real.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"tarjama/web/internal/studio"
	"time"
)

type reviewBody struct {
	io.Reader
	io.Closer
}

type reviewTransport struct{ base http.RoundTripper }

func (t reviewTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(r)
	if r.URL.Hostname() == "generativelanguage.googleapis.com" || r.URL.Hostname() == "api.groq.com" {
		if err != nil {
			log.Printf("Provider %s transport error", r.URL.Hostname())
		} else {
			log.Printf("Provider %s HTTP %d", r.URL.Hostname(), response.StatusCode)
			if response.StatusCode >= 400 {
				// Keep the provider body readable by the real client. Log only recognized
				// error categories and quota metric IDs, never raw messages or values.
				raw, _ := io.ReadAll(io.LimitReader(response.Body, 65536))
				response.Body = &reviewBody{Reader: io.MultiReader(bytes.NewReader(raw), response.Body), Closer: response.Body}
				var payload struct {
					Error struct {
						Message string `json:"message"`
						Details []struct {
							Violations []struct {
								Metric string `json:"quotaMetric"`
								ID     string `json:"quotaId"`
							} `json:"violations"`
						} `json:"details"`
					} `json:"error"`
				}
				if json.Unmarshal(raw, &payload) == nil {
					for _, category := range []string{"quota", "rate limit", "overloaded", "high demand", "billing", "capacity"} {
						if strings.Contains(strings.ToLower(payload.Error.Message), category) {
							log.Printf("Provider error category: %s", category)
						}
					}
					validMetric := regexp.MustCompile(`^[A-Za-z0-9_./-]{1,160}$`)
					for _, detail := range payload.Error.Details {
						for _, violation := range detail.Violations {
							if strings.HasPrefix(violation.Metric, "generativelanguage.googleapis.com/") && validMetric.MatchString(violation.Metric) && validMetric.MatchString(violation.ID) {
								log.Printf("Gemini quota metric=%s id=%s", violation.Metric, violation.ID)
							}
						}
					}
				}
			}
		}
	}
	return response, err
}
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
func run() error {
	if os.Getenv("UI_REVIEW") != "atelier-20260923" {
		return errors.New("explicit private review required")
	}
	http.DefaultTransport = reviewTransport{http.DefaultTransport}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Hour)
	defer cancel()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return err
	}
	os.Setenv("ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	c, err := studio.LoadConfig()
	if err != nil {
		return err
	}
	if c.Mode != "test" || c.MediaEngine != "isolated-jobs" {
		return errors.New("real isolated engine and test identity required")
	}
	runID := os.Getenv("UI_REVIEW_RUN")
	if runID == "" {
		runID = "20260923"
	}
	if !regexp.MustCompile(`^[a-z0-9][a-z0-9_]{0,39}$`).MatchString(runID) {
		return errors.New("invalid review run ID")
	}
	schema := "ui_review_" + runID
	c.Storage = "/storage/ui-review-" + runID
	if err = os.MkdirAll(filepath.Join(c.Storage, "artifacts"), 0700); err != nil {
		return err
	}
	startup, stop := context.WithTimeout(ctx, time.Minute)
	root, err := studio.OpenWhenReady(startup, c.DB)
	stop()
	if err != nil {
		return err
	}
	_, err = root.DB.Exec(ctx, "CREATE SCHEMA IF NOT EXISTS "+schema)
	root.DB.Close()
	if err != nil {
		return errors.New("test schema creation failed")
	}
	cfg, err := pgxpool.ParseConfig(c.DB)
	if err != nil {
		return errors.New("test database configuration failed")
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.MaxConns = 5
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return errors.New("test database unavailable")
	}
	defer pool.Close()
	store := &studio.Store{DB: pool}
	if err = store.Migrate(ctx); err != nil {
		return err
	}
	auth, err := studio.NewAuth(ctx, store, c)
	if err != nil {
		return err
	}
	api := (&studio.API{Store: store, Config: c, Auth: auth}).Routes()
	go func() {
		if err := studio.RunWorker(ctx, store, c); err != nil {
			log.Print("Review worker stopped: ", err)
			cancel()
		}
	}()
	names := regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,150}$`)
	mux := http.NewServeMux()
	mux.HandleFunc("PUT /review-artifacts/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if !names.MatchString(name) {
			http.Error(w, "name", 400)
			return
		}
		path := filepath.Join(c.Storage, "artifacts", name)
		f, e := os.OpenFile(path+".part", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			http.Error(w, "storage", 500)
			return
		}
		_, e = io.Copy(f, http.MaxBytesReader(w, r.Body, 1024*1024*1024))
		closeErr := f.Close()
		if e != nil || closeErr != nil {
			os.Remove(path + ".part")
			http.Error(w, "upload", 400)
			return
		}
		if os.Link(path+".part", path) != nil {
			os.Remove(path + ".part")
			http.Error(w, "storage", 500)
			return
		}
		os.Remove(path + ".part")
		w.WriteHeader(204)
	})
	mux.HandleFunc("GET /review-artifacts/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if !names.MatchString(name) {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(c.Storage, "artifacts", name))
	})
	mux.Handle("/", api)
	server := studio.HTTPServer(c.Addr, mux)
	go func() { <-ctx.Done(); server.Close() }()
	log.Print("Private UI review ready; independent schema, real providers and isolated media")
	err = server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
