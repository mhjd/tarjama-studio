package studio

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTranslationResearchAndProvenance(t *testing.T) {
	for _, forged := range []bool{false, true} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			tools, ok := body["tools"].([]any)
			if !ok || len(tools) != 2 {
				t.Error("research declarations unavailable")
			}
			encoded, _ := json.Marshal(tools)
			if !strings.Contains(string(encoded), "web_search") || !strings.Contains(string(encoded), "web_fetch") || strings.Contains(string(encoded), "google_search") || strings.Contains(string(encoded), "url_context") {
				t.Error("Parallel tools contract")
			}
			instruction, _ := json.Marshal(body["messages"])
			for _, rule := range []string{"quran_fr", "sahih_ar", "hadith_ar", "Parallel"} {
				if !strings.Contains(string(instruction), rule) {
					t.Error("lost desktop rule", rule)
				}
			}
			content := `{"segments":[{"id":"a","text":"Bonjour"}]}`
			if forged {
				content = `{"segments":[{"id":"a","text":"Bonjour"}],"grounding":{"verified":true}}`
			}
			json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{
				"finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": content},
				"groundingMetadata": map[string]any{"webSearchQueries": []string{"site:quran.com test"}},
			}}})
		}))
		p := NewProviders()
		p.TextURL = server.URL
		result, err := p.Text(context.Background(), "fixture", "translate", []Segment{{ID: "a", Arabic: "سلام"}}, nil)
		server.Close()
		if forged {
			if err == nil {
				t.Fatal("model forged provenance")
			}
			continue
		}
		if err != nil || !strings.Contains(string(result.Grounding), `"engine":"parallel"`) || strings.Contains(string(result.Grounding), "site:quran.com") {
			t.Fatal("native metadata was trusted or application audit lost", err)
		}
	}
}

func TestGeminiCredentialRemainsHistoricalOnly(t *testing.T) {
	s := testStore(t)
	owner, _ := fixture(t, s)
	a, server := testAPI(t, s)
	old, e := seal(a.Config.EncryptionKey, owner, "gemini", "historical-secret")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.DB.Exec(context.Background(), "INSERT INTO credentials(owner_id,provider,ciphertext) VALUES($1,'gemini',$2)", owner, old); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.Key(context.Background(), a.Config, owner, "gemini"); e == nil {
		t.Fatal("retired credential used")
	}
	if e = s.SetKey(context.Background(), a.Config, owner, "gemini", "new-value"); e == nil {
		t.Fatal("retired provider accepted")
	}
	token, csrf := sessionFor(t, s, owner)
	code, body := call(t, server, token, csrf, "GET", "/api/credentials", nil)
	if code != 200 || strings.Contains(string(body), "gemini") || !strings.Contains(string(body), "openrouter") {
		t.Fatal(code, string(body))
	}
	if e = s.Migrate(context.Background()); e != nil {
		t.Fatal("migration is not repeatable", e)
	}
	var retained bool
	if e = s.DB.QueryRow(context.Background(), "SELECT EXISTS(SELECT 1 FROM credentials WHERE owner_id=$1 AND provider='gemini')", owner).Scan(&retained); e != nil || !retained {
		t.Fatal("legacy key deleted", e)
	}
}
