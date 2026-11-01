package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"tarjama/web/internal/references"
	"tarjama/web/internal/studio"
	"testing"
)

func TestWebTextParity(t *testing.T) {
	t.Setenv("OPENROUTER_API_KEY", "fixture")
	t.Setenv("OPENROUTER_API_KEY_FILE", "")
	dir := t.TempDir()
	entry, _ := json.Marshal(references.Entry{Collection: "quran", Reference: "1:1", Arabic: "نص اختبار", French: "Test", SourceURL: "https://tanzil.net", Numbering: "surah:verse"})
	entry = append(entry, '\n')
	hash := sha256.Sum256(entry)
	manifest, _ := json.Marshal(references.Manifest{Version: "fixture", SHA256: hex.EncodeToString(hash[:]), Collections: map[string]references.Coverage{"quran": {Count: 1}}})
	if err := os.WriteFile(filepath.Join(dir, "entries.jsonl"), entry, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), manifest, 0600); err != nil {
		t.Fatal(err)
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["model"] != studio.TextModel || body["max_tokens"] != float64(studio.TextMaxOutputTokens) {
			t.Error("model/output budget drift")
		}
		if body["reasoning"].(map[string]any)["effort"] != studio.TextReasoningEffort {
			t.Error("reasoning drift")
		}
		if len(body["tools"].([]any)) != 3 {
			t.Error("expected Parallel search/fetch and local Quran tool")
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"role": "assistant", "content": `{"segments":[{"id":"a","text":"Bonjour."}]}`}}}})
	}))
	defer server.Close()
	p := studio.NewProviders()
	p.TextURL = server.URL
	segments := []studio.Segment{{ID: "a", Start: 0, End: 1000, Arabic: "سلام", Version: 1}}
	for _, kind := range []string{"cleanup", "translate"} {
		result, err := execute(context.Background(), request{Kind: kind, Corpus: dir, Segments: segments}, p)
		if err != nil || result.(studio.TextResult).Segments[0].ID != "a" {
			t.Fatal(result, err)
		}
	}
	if calls != 2 {
		t.Fatal(calls)
	}
	if _, err := execute(context.Background(), request{Kind: "translate", Corpus: dir, Segments: segments, Chunk: 5}, p); err == nil {
		t.Fatal("invalid chunk accepted")
	}
	if calls != 2 {
		t.Fatal("invalid input spent a request")
	}
}

func TestMissingKeyAndWebASRMerge(t *testing.T) {
	t.Setenv("GROQ_API_KEY", "")
	t.Setenv("GROQ_API_KEY_FILE", "")
	p := studio.NewProviders()
	if _, err := execute(context.Background(), request{Kind: "audio"}, p); err == nil {
		t.Fatal("missing key")
	}
	chunk := studio.ASRChunk{Start: 0, Duration: 2, Response: studio.ASRResponse{Segments: []studio.ASRSegment{{Start: .2, End: 1.5, Text: "نص"}}}}
	result, err := execute(context.Background(), request{Kind: "merge-asr", ASRChunks: []studio.ASRChunk{chunk}, TotalDuration: 2000}, p)
	if err != nil {
		t.Fatal(err)
	}
	segments := result.([]studio.Segment)
	if len(segments) != 1 || segments[0].Start != 200 || segments[0].End != 1500 {
		t.Fatal(segments)
	}
}

func TestSubtitlesUseWebRendererWithoutProvider(t *testing.T) {
	segments := []studio.Segment{{ID: "a", Start: 0, End: 2000, Arabic: "نص", French: "Bonjour.", Version: 1},
		{ID: "b", Start: 2000, End: 5000, Arabic: "نص", French: "La suite.", Version: 1}}
	result, err := execute(context.Background(), request{Kind: "subtitles", Segments: segments, Width: 1080, Height: 1920}, nil)
	if err != nil {
		t.Fatal(err)
	}
	files := result.(map[string]string)
	if files["ass"] != studio.ASS(segments, 1080, 1920, "fr") || files["srt"] != studio.SRT(segments, "fr") {
		t.Fatal("subtitle renderer drift")
	}
	if _, err := execute(context.Background(), request{Kind: "subtitles", Segments: segments, Width: 0, Height: 1920}, nil); err == nil {
		t.Fatal("invalid dimensions accepted")
	}
}
