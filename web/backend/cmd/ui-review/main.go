// Dedicated private UI qualification server. Never linked into the release binary.
// Only a separate test schema and directory are used. OIDC and live user data
// are deliberately absent; providers and the isolated media engine are real.
package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"tarjama/web/internal/studio"
	"time"
)

type reviewTransport struct{ base http.RoundTripper }

func (t reviewTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(r)
	if r.URL.Hostname() == "generativelanguage.googleapis.com" || r.URL.Hostname() == "api.groq.com" {
		if err != nil {
			log.Printf("Provider %s transport error", r.URL.Hostname())
		} else {
			log.Printf("Provider %s HTTP %d", r.URL.Hostname(), response.StatusCode)
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
	c.Storage = "/storage/ui-review-20260923"
	if err = os.MkdirAll(filepath.Join(c.Storage, "artifacts"), 0700); err != nil {
		return err
	}
	startup, stop := context.WithTimeout(ctx, time.Minute)
	root, err := studio.OpenWhenReady(startup, c.DB)
	stop()
	if err != nil {
		return err
	}
	_, err = root.DB.Exec(ctx, "CREATE SCHEMA IF NOT EXISTS ui_review_20260923")
	root.DB.Close()
	if err != nil {
		return errors.New("test schema creation failed")
	}
	cfg, err := pgxpool.ParseConfig(c.DB)
	if err != nil {
		return errors.New("test database configuration failed")
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = "ui_review_20260923"
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
		f, e := os.OpenFile(path+".part", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
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
		if os.Rename(path+".part", path) != nil {
			http.Error(w, "storage", 500)
			return
		}
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
