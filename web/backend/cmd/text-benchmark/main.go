// Standalone, opt-in quality evaluation. No database, application worker or media.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"tarjama/web/internal/studio"
	"time"
)

type auditTransport struct {
	dir  string
	base http.RoundTripper
}

func write(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(data)
	return err
}
func (t auditTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	// Only bodies are saved; headers (API key) and transport errors never are.
	request, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, errors.New("request read failed")
	}
	r.Body = io.NopCloser(bytes.NewReader(request))
	if err = write(filepath.Join(t.dir, "request.json"), request); err != nil {
		return nil, err
	}
	response, err := t.base.RoundTrip(r)
	if err != nil {
		return nil, errors.New("provider connection failed")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
	response.Body.Close()
	if err != nil || len(raw) > 4*1024*1024 {
		return nil, errors.New("provider response unreadable or oversized")
	}
	// Errors may include account identifiers: record only status, never the body.
	if response.StatusCode == 200 {
		if err = write(filepath.Join(t.dir, "response.raw.json"), raw); err != nil {
			return nil, err
		}
	}
	fmt.Printf("HTTP %d\n", response.StatusCode)
	response.Body = io.NopCloser(bytes.NewReader(raw))
	return response, nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	input := flag.String("input", "", "public JSON segments fixture")
	output := flag.String("output", "", "new immutable result directory")
	read := flag.Bool("read-next", false, "read next bounded text page from a completed run")
	flag.Parse()
	if *output == "" {
		return errors.New("output directory required")
	}
	if *read {
		return readNext(*output)
	}
	if *input == "" {
		return errors.New("input required")
	}
	raw, err := os.ReadFile(*input)
	if err != nil {
		return errors.New("fixture unavailable")
	}
	var s []studio.Segment
	if err = json.Unmarshal(raw, &s); err != nil {
		return errors.New("invalid fixture")
	}
	if err = studio.ValidateSegments(s); err != nil {
		return err
	}
	if len(studio.TextChunks(s)) != 1 {
		return errors.New("fixture must fit one application chunk")
	}
	// Mkdir, never MkdirAll for the run: refuse overwriting any earlier evidence.
	if err = os.MkdirAll(filepath.Dir(*output), 0700); err != nil {
		return err
	}
	if err = os.Mkdir(*output, 0700); err != nil {
		return errors.New("result directory exists or unavailable; use a new run ID")
	}
	if err = write(filepath.Join(*output, "input.json"), raw); err != nil {
		return err
	}
	key, err := os.ReadFile(os.Getenv("GEMINI_API_KEY_FILE"))
	if err != nil || len(bytes.TrimSpace(key)) == 0 {
		return errors.New("registered Gemini secret unavailable")
	}
	p := studio.NewProviders()
	p.Client.Transport = auditTransport{*output, http.DefaultTransport}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	// Bounded readiness check without spending a model call or logging credentials.
	ready := false
	for attempt := 0; attempt < 20; attempt++ {
		req, _ := http.NewRequestWithContext(ctx, "GET", "https://generativelanguage.googleapis.com/", nil)
		client := &http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		response, e := client.Do(req)
		if e == nil {
			response.Body.Close()
			ready = true
			break
		}
		select {
		case <-ctx.Done():
			return errors.New("startup timed out")
		case <-time.After(2 * time.Second):
		}
	}
	if !ready {
		return errors.New("provider network unavailable after bounded wait")
	}
	start := time.Now()
	result, err := p.Text(ctx, strings.TrimSpace(string(key)), "translate", s, nil)
	if err != nil {
		return err
	} // One generation attempt, no hidden quota-spending retry.
	b, _ := json.MarshalIndent(result, "", "  ")
	if err = write(filepath.Join(*output, "translation.json"), b); err != nil {
		return err
	}
	hash := sha256.Sum256(b)
	summary := map[string]any{"model": studio.GeminiModel, "segments": len(s), "duration_ms": s[len(s)-1].End - s[0].Start, "elapsed_seconds": time.Since(start).Seconds(), "translation_sha256": hex.EncodeToString(hash[:]), "output_tokens_budget": studio.GeminiMaxOutputTokens, "timestamp": time.Now().UTC().Format(time.RFC3339)}
	summaryBytes, _ := json.Marshal(summary)
	if err = write(filepath.Join(*output, "summary.json"), summaryBytes); err != nil {
		return err
	}
	fmt.Println("RESULT " + string(summaryBytes))
	return nil
}

// A named admin job may be rerun to retrieve small JSON-text pages through the
// broker's bounded logs. No runtime exec, secret output or external upload.
func readNext(dir string) error {
	b, err := os.ReadFile(filepath.Join(dir, "translation.json"))
	if err != nil {
		return errors.New("translation unavailable")
	}
	var result studio.TextResult
	if json.Unmarshal(b, &result) != nil {
		return errors.New("invalid stored result")
	}
	cursorPath := filepath.Join(dir, "read-cursor.json")
	offset := 0
	if cursor, e := os.ReadFile(cursorPath); e == nil {
		if json.Unmarshal(cursor, &offset) != nil {
			return errors.New("invalid cursor")
		}
	} else if !os.IsNotExist(e) {
		return errors.New("cursor unavailable")
	}
	if offset < 0 || offset > len(result.Segments) {
		return errors.New("invalid cursor")
	}
	end := offset
	for end < len(result.Segments) {
		candidate, _ := json.Marshal(result.Segments[offset : end+1])
		if len(candidate) > 2200 && end > offset {
			break
		}
		end++
	}
	page := map[string]any{"offset": offset, "next": end, "total": len(result.Segments), "segments": result.Segments[offset:end]}
	encoded, _ := json.Marshal(page)
	fmt.Println("PAGE " + string(encoded))
	next, _ := json.Marshal(end)
	return os.WriteFile(cursorPath, next, 0600)
}
