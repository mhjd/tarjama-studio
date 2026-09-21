// Local-only browser fixture server. This command is never included in the release image.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"tarjama/web/internal/studio"
	"time"
)

type mock struct{}

func (mock) Text(ctx context.Context, key, kind string, s, c []studio.Segment) (studio.TextResult, error) {
	var result studio.TextResult
	for _, x := range s {
		text := x.Arabic
		if kind == "translate" {
			text = "Bienvenue à tous."
		}
		result.Segments = append(result.Segments, struct {
			ID   string `json:"id"`
			Text string `json:"text"`
		}{x.ID, text})
	}
	return result, nil
}
func (mock) Audio(context.Context, string, string) (studio.ASRResponse, json.RawMessage, error) {
	return studio.ASRResponse{Segments: []studio.ASRSegment{{Start: 0, End: 2, Text: "السلام عليكم"}}}, json.RawMessage(`{"fixture":true}`), nil
}
func main() {
	if e := run(); e != nil {
		log.Fatal(e)
	}
}
func run() error {
	ctx := context.Background()
	c, e := studio.LoadConfig()
	if e != nil {
		return e
	}
	if c.Mode != "test" {
		return errors.New("fixture requires APP_MODE=test")
	}
	c.GeminiKey = "mock-only"
	c.GroqKey = "mock-only"
	s, e := studio.Open(ctx, c.DB)
	if e != nil {
		return e
	}
	defer s.DB.Close()
	if e = s.Migrate(ctx); e != nil {
		return e
	}
	if e = os.MkdirAll(c.Storage, 0700); e != nil {
		return e
	}
	media := filepath.Join(c.Storage, "fixture.mp4")
	if _, e = os.Stat(media); os.IsNotExist(e) {
		if out, e := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=0x31453b:s=320x240:d=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", media).CombinedOutput(); e != nil {
			return errors.New(string(out))
		}
	}
	uid, e := s.User(ctx, "development", "alice")
	if e != nil {
		return e
	}
	if _, e = s.User(ctx, "development", "bob"); e != nil {
		return e
	}
	list, e := s.List(ctx, uid)
	if e != nil {
		return e
	}
	if len(list) == 0 {
		p := studio.Project{ID: "fixture", Title: "Cours d’arabe", Stage: "arabic", Version: 1, ArabicVersion: 1, Generation: 1, Media: "fixture.mp4", Duration: 4000, Width: 320, Height: 240, Segments: []studio.Segment{{ID: "one", Start: 0, End: 2000, Arabic: "السلام عليكم", Version: 1}, {ID: "two", Start: 2000, End: 4000, Arabic: "مرحبا بكم", Version: 1}}}
		if e = s.Create(ctx, uid, p); e != nil {
			return e
		}
	}
	worker := studio.Worker{Store: s, Config: c, Providers: mock{}, Media: studio.LocalMedia{Test: true}}
	go func() {
		for {
			worker.Once(ctx)
			time.Sleep(150 * time.Millisecond)
		}
	}()
	auth, e := studio.NewAuth(ctx, s, c)
	if e != nil {
		return e
	}
	api := &studio.API{Store: s, Config: c, Auth: auth}
	addr := os.Getenv("FIXTURE_LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8090"
	}
	server := studio.HTTPServer(addr, api.Routes())
	e = server.ListenAndServe()
	if errors.Is(e, http.ErrServerClosed) {
		return nil
	}
	return e
}
