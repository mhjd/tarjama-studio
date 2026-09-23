package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"tarjama/web/internal/studio"
	"time"
)

func main() {
	if e := run(); e != nil {
		log.Fatal(e)
	}
}
func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	command := "api"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	if command == "healthcheck" {
		client := http.Client{Timeout: 3 * time.Second}
		r, e := client.Get("http://127.0.0.1:8090/readyz")
		if e != nil {
			return fmt.Errorf("not ready")
		}
		defer r.Body.Close()
		if r.StatusCode != 204 {
			return fmt.Errorf("not ready")
		}
		return nil
	}
	if command == "media" {
		return studio.RunMedia(ctx)
	}
	if command == "egress" {
		return studio.RunEgress(ctx)
	}
	if command == "sandbox-check" {
		return studio.CheckMediaSandbox(ctx)
	}
	if command == "isolated-tool" {
		return studio.RunIsolatedTool(ctx, os.Args[2:])
	}
	if command == "migrate" {
		dsn, e := studio.LoadDatabaseURL()
		if e != nil {
			return e
		}
		migration, cancel := context.WithTimeout(ctx, 240*time.Second)
		defer cancel()
		startup, ready := context.WithTimeout(migration, 90*time.Second)
		s, e := studio.OpenWhenReady(startup, dsn)
		ready()
		if e != nil {
			return e
		}
		defer s.DB.Close()
		return s.Migrate(migration)
	}
	loadConfig := studio.LoadConfig
	if command == "worker" {
		loadConfig = studio.LoadWorkerConfig
	}
	c, e := loadConfig()
	if e != nil {
		return e
	}
	s, e := studio.Open(ctx, c.DB)
	if e != nil {
		return fmt.Errorf("Base indisponible")
	}
	defer s.DB.Close()
	switch command {
	case "worker":
		return studio.RunWorker(ctx, s, c)
	case "import":
		return studio.ImportCommand(ctx, s, c, os.Args[2:])
	case "gc":
		return studio.GarbageCollect(ctx, s, c)
	case "api":
		if e = os.MkdirAll(c.Storage, 0700); e != nil {
			return e
		}
		auth, e := studio.NewAuth(ctx, s, c)
		if e != nil {
			return e
		}
		server := studio.HTTPServer(c.Addr, (&studio.API{Store: s, Config: c, Auth: auth}).Routes())
		go func() {
			<-ctx.Done()
			end, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			server.Shutdown(end)
		}()
		log.Print("Tarjama API prête")
		return server.ListenAndServe()
	default:
		return fmt.Errorf("Commande inconnue")
	}
}
