package references

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) (string, *Store) {
	t.Helper()
	dir := t.TempDir()
	es := []Entry{
		{Collection: "quran", Reference: "1:1", Arabic: "أَلْف باء جيم", French: "Texte de test uniquement", SourceURL: "https://tanzil.net", Numbering: "surah:verse"},
		{Collection: "quran", Reference: "1:2", Arabic: "ألف باء جيم دال", French: "Autre fixture", SourceURL: "https://tanzil.net", Numbering: "surah:verse"},
		{Collection: "muslim", Reference: "1907a", Arabic: "حديث عربي للاختبار فقط", SourceURL: "https://sunnah.com/muslim:1907a", Numbering: "fixture"},
	}
	var b []byte
	for _, e := range es {
		x, _ := json.Marshal(e)
		b = append(b, x...)
		b = append(b, '\n')
	}
	h := sha256.Sum256(b)
	m := Manifest{Version: "test", SHA256: hex.EncodeToString(h[:]), Collections: map[string]Coverage{"quran": {Count: 2}, "muslim": {Count: 1}}}
	mb, _ := json.Marshal(m)
	os.WriteFile(filepath.Join(dir, "manifest.json"), mb, 0600)
	os.WriteFile(filepath.Join(dir, "entries.jsonl"), b, 0600)
	s, e := Load(dir)
	if e != nil {
		t.Fatal(e)
	}
	return dir, s
}
func TestReferencesPreserveTextAndVariants(t *testing.T) {
	_, s := fixture(t)
	r, e := s.Lookup("quran_fr", Query{Surah: 1, Verse: 1, EndVerse: 2})
	if e != nil || r.Status != "found" || len(r.Entries) != 2 || r.Entries[0].Arabic != "أَلْف باء جيم" {
		t.Fatal(r, e)
	}
	r, e = s.Lookup("quran_fr", Query{ArabicQuery: "الف باء جيم"})
	if e != nil || r.Status != "ambiguous" || len(r.Entries) != 2 {
		t.Fatal(r, e)
	}
	r, e = s.Lookup("sahih_ar", Query{Collection: "muslim", Reference: "1907a"})
	if e != nil || r.Status != "found" || !strings.HasSuffix(r.Entries[0].SourceURL, "1907a") {
		t.Fatal(r, e)
	}
	r, _ = s.Lookup("sahih_ar", Query{Collection: "muslim", Reference: "1907"})
	if r.Status != "ambiguous" || r.Match != "reference_variants" {
		t.Fatal(r)
	}
	r, _ = s.Lookup("hadith_ar", Query{Collection: "riyadussalihin", Reference: "1"})
	if r.Status != "corpus_unavailable" {
		t.Fatal(r)
	}
	r, _ = s.Lookup("quran_fr", Query{Surah: 1, Verse: 2, EndVerse: 3})
	if r.Status != "not_found" || len(r.Entries) != 0 {
		t.Fatal("partial range returned", r)
	}
}
func TestRejectUnsafeOrAmbiguousQueries(t *testing.T) {
	_, s := fixture(t)
	for _, q := range []string{`{"surah":1,"verse":1,"arabic_query":"الف باء جيم"}`, `{"surah":1,"verse":1,"end_verse":22}`, `{"arabic_query":"الف"}`, `{"url":"http://localhost"}`, `{"surah":1,"verse":1} {}`, `{"collection":"muslim","reference":"1"}`} {
		if _, e := s.Call("quran_fr", json.RawMessage(q)); e == nil {
			t.Fatal("accepted", q)
		}
	}
	if _, e := s.Call("web_fetch", json.RawMessage(`{}`)); e == nil {
		t.Fatal("arbitrary tool")
	}
}

func TestModelOnlyHasQuranAccess(t *testing.T) {
	_, s := fixture(t)
	definitions, err := json.Marshal(s.Tools())
	if err != nil || len(s.Tools()) != 1 || !strings.Contains(string(definitions), `"name":"quran_fr"`) {
		t.Fatal("expected only the Quran tool", string(definitions), err)
	}
	result, err := s.Call("quran_fr", json.RawMessage(`{"surah":1,"verse":1}`))
	if err != nil || result.(Result).Status != "found" {
		t.Fatal("Quran lookup unavailable", result, err)
	}
	for _, name := range []string{"sahih_ar", "hadith_ar"} {
		if result, err := s.Call(name, json.RawMessage(`{"collection":"muslim","reference":"1907a"}`)); err == nil || result != nil {
			t.Fatal("disabled tool returned data", name, result, err)
		}
	}
}
func TestTamperDetected(t *testing.T) {
	dir, _ := fixture(t)
	f, _ := os.OpenFile(filepath.Join(dir, "entries.jsonl"), os.O_APPEND|os.O_WRONLY, 0600)
	f.WriteString("\n")
	f.Close()
	if _, e := Load(dir); e == nil {
		t.Fatal("tamper accepted")
	}
}
func TestCanonicalURLCannotPointAtPrivateServer(t *testing.T) {
	for _, s := range []string{"http://quran.com/1/1", "https://quran.com.evil/", "https://a@quran.com/", "https://127.0.0.1/", "https://quran.com:8443/"} {
		if safeURL(s) {
			t.Fatal(s)
		}
	}
}
