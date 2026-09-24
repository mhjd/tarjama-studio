package studio

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func twentyMinuteSegments() []Segment {
	var s []Segment
	for i := 0; i < 400; i++ {
		s = append(s, Segment{ID: fmt.Sprint(i), Start: int64(i) * 3000, End: int64(i+1) * 3000, Arabic: strings.Repeat("كلمة ", 10), Version: 1})
	}
	return s
}
func TestTenMinuteTextChunks(t *testing.T) {
	s := twentyMinuteSegments()
	chunks := TextChunks(s)
	if len(chunks) != 2 || len(chunks[0]) != 200 || len(chunks[1]) != 200 {
		t.Fatalf("20 minutes must make two 10-minute chunks: %d chunks", len(chunks))
	}
	s = append(s, Segment{ID: "next", Start: 1200000, End: 1203000, Arabic: "التالي"})
	chunks = TextChunks(s)
	if len(chunks) != 3 || len(chunks[2]) != 1 {
		t.Fatal("boundary lost")
	}
	// Dense/very short segments must still respect count and byte guards.
	for i := range s {
		s[i].Arabic = strings.Repeat("ع", 700)
	}
	chunks = TextChunks(s)
	count := 0
	for _, chunk := range chunks {
		size := 0
		for _, x := range chunk {
			size += len(x.Arabic)
		}
		if size > textChunkMaxBytes {
			t.Fatal("byte budget")
		}
		count += len(chunk)
	}
	if count != len(s) {
		t.Fatal("dropped segments")
	}
	short := make([]Segment, 601)
	for i := range short {
		short[i] = Segment{ID: fmt.Sprint(i), Start: int64(i), End: int64(i + 1), Arabic: "نعم"}
	}
	if chunks = TextChunks(short); len(chunks) != 2 || len(chunks[0]) != 600 {
		t.Fatal("count guard")
	}
}
func TestResumeOldTextBoundaries(t *testing.T) {
	s := twentyMinuteSegments()
	provider := &scriptedProvider{}
	old, _ := provider.Text(context.Background(), "", "translate", s[:120], nil)
	raw, _ := json.Marshal(old)
	chunks, err := resumeTextChunks(s, []json.RawMessage{raw})
	if err != nil || len(chunks) != 3 || len(chunks[0]) != 120 || len(chunks[1]) != 200 || len(chunks[2]) != 80 {
		t.Fatalf("legacy checkpoint: %v %d", err, len(chunks))
	}
	rest, _ := provider.Text(context.Background(), "", "translate", s[120:], nil)
	next, _ := json.Marshal(rest)
	if chunks, err = resumeTextChunks(s, []json.RawMessage{raw, next}); err != nil || len(chunks) != 2 {
		t.Fatal("completed results lost", err)
	}
	// A previously completed 20-minute chunk is not replayed after the policy change.
	legacy, _ := provider.Text(context.Background(), "", "translate", s, nil)
	legacyRaw, _ := json.Marshal(legacy)
	extended := append(append([]Segment{}, s...), Segment{ID: "next", Start: 1200000, End: 1203000, Arabic: "التالي"})
	if chunks, err = resumeTextChunks(extended, []json.RawMessage{legacyRaw}); err != nil || len(chunks) != 2 || len(chunks[0]) != 400 || len(chunks[1]) != 1 {
		t.Fatal("completed legacy chunk replayed", err)
	}
	old.Segments[0].ID = "unknown"
	invalid, _ := json.Marshal(old)
	for _, bad := range []json.RawMessage{invalid, []byte(`{"segments":[]}`), []byte(`{`)} {
		if _, err = resumeTextChunks(s, []json.RawMessage{bad}); err == nil {
			t.Fatal("invalid checkpoint accepted")
		}
	}
	if _, err = resumeTextChunks(s, []json.RawMessage{raw, raw}); err == nil {
		t.Fatal("duplicated checkpoint accepted")
	}
}
func TestDeepSeekRequestBudget(t *testing.T) {
	p := NewProviders()
	if !strings.Contains(p.TextURL, "openrouter.ai/api/v1/chat/completions") {
		t.Fatal(p.TextURL)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Model           string `json:"model"`
			MaxOutputTokens int    `json:"max_tokens"`
		}
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			t.Fatal(err)
		}
		if b.MaxOutputTokens != 32768 || b.Model != TextModel {
			t.Error("insufficient output budget")
		}
		fmt.Fprint(w, `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"{\"segments\":[{\"id\":\"a\",\"text\":\"Bonjour\"}]}"}}]}`)
	}))
	defer server.Close()
	p.TextURL = server.URL
	if _, err := p.Text(context.Background(), "test-only", "translate", []Segment{{ID: "a", Arabic: "سلام"}}, nil); err != nil {
		t.Fatal(err)
	}
}
