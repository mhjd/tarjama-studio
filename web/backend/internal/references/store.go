// Package references serves immutable, attributed local texts. Search results
// are evidence for a translator, never an automatic theological identification.
package references

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

type Entry struct {
	Collection   string `json:"collection"`
	Reference    string `json:"reference"`
	Arabic       string `json:"arabic"`
	French       string `json:"french,omitempty"`
	SourceURL    string `json:"source_url"`
	CanonicalURL string `json:"canonical_url,omitempty"`
	Numbering    string `json:"numbering"`
}
type Coverage struct {
	Notes    string `json:"notes,omitempty"`
	Count    int    `json:"count"`
	Edition  string `json:"edition"`
	License  string `json:"license"`
	Source   string `json:"source"`
	Complete bool   `json:"complete"`
}
type Manifest struct {
	Version     string              `json:"version"`
	SHA256      string              `json:"sha256"`
	Collections map[string]Coverage `json:"collections"`
}
type Store struct {
	manifest    Manifest
	entries     []Entry
	normalized  []string
	byReference map[string][]int
	byFamily    map[string][]int
	byWord      map[string][]int
}
type Query struct {
	Collection  string `json:"collection,omitempty"`
	Reference   string `json:"reference,omitempty"`
	ArabicQuery string `json:"arabic_query,omitempty"`
	Surah       int    `json:"surah,omitempty"`
	Verse       int    `json:"verse,omitempty"`
	EndVerse    int    `json:"end_verse,omitempty"`
}
type Result struct {
	Status   string              `json:"status"`
	Match    string              `json:"match,omitempty"`
	Version  string              `json:"version"`
	Coverage map[string]Coverage `json:"coverage"`
	Entries  []Entry             `json:"entries"`
	More     bool                `json:"more_candidates"`
}

// Normalize changes only the search index. Canonical text is returned verbatim.
func Normalize(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.Is(unicode.Mn, r) || r == '\u0640' {
			continue
		}
		switch r {
		case 'أ', 'إ', 'آ', 'ٱ':
			r = 'ا'
		case 'ى':
			r = 'ي'
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(unicode.ToLower(r))
		} else {
			b.WriteByte(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}
func safeURL(s string) bool {
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	switch u.Hostname() {
	case "tanzil.net", "quran.com", "sunnah.com", "raw.githubusercontent.com", "cdn.jsdelivr.net":
		return true
	}
	return false
}
func Load(dir string) (*Store, error) {
	b, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return nil, err
	}
	s := &Store{byReference: map[string][]int{}, byFamily: map[string][]int{}, byWord: map[string][]int{}}
	if len(b) > 65536 || json.Unmarshal(b, &s.manifest) != nil || s.manifest.Version == "" || len(s.manifest.Collections) == 0 {
		return nil, errors.New("invalid corpus manifest")
	}
	f, err := os.Open(filepath.Join(dir, "entries.jsonl"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	h := sha256.New()
	reader := io.TeeReader(io.LimitReader(f, 128*1024*1024+1), h)
	scan := bufio.NewScanner(reader)
	scan.Buffer(make([]byte, 65536), 128*1024)
	counts := map[string]int{}
	for scan.Scan() {
		var e Entry
		if json.Unmarshal(scan.Bytes(), &e) != nil || strings.TrimSpace(e.Arabic) == "" || len(e.Arabic) > 60000 || e.Reference == "" || !safeURL(e.SourceURL) || (e.CanonicalURL != "" && !safeURL(e.CanonicalURL)) {
			return nil, errors.New("invalid corpus entry")
		}
		if _, ok := s.manifest.Collections[e.Collection]; !ok {
			return nil, errors.New("undeclared collection")
		}
		if e.Collection == "quran" && e.French == "" {
			return nil, errors.New("missing Quran translation")
		}
		if e.Collection != "quran" && e.French != "" {
			return nil, errors.New("hadith must be Arabic only")
		}
		i := len(s.entries)
		if i >= 100000 {
			return nil, errors.New("corpus too large")
		}
		s.entries = append(s.entries, e)
		n := Normalize(e.Arabic)
		s.normalized = append(s.normalized, n)
		k := e.Collection + ":" + e.Reference
		s.byReference[k] = append(s.byReference[k], i)
		if e.Collection != "quran" && len(e.Reference) > 1 {
			last := e.Reference[len(e.Reference)-1]
			if last >= 'a' && last <= 'z' {
				base := e.Reference[:len(e.Reference)-1]
				if _, err := strconv.Atoi(base); err == nil {
					key := e.Collection + ":" + base
					s.byFamily[key] = append(s.byFamily[key], i)
				}
			}
		}
		seen := map[string]bool{}
		for _, w := range strings.Fields(n) {
			if !seen[w] {
				s.byWord[w] = append(s.byWord[w], i)
				seen[w] = true
			}
		}
		counts[e.Collection]++
	}
	if err = scan.Err(); err != nil {
		return nil, err
	}
	if hex.EncodeToString(h.Sum(nil)) != s.manifest.SHA256 {
		return nil, errors.New("corpus hash mismatch")
	}
	for k, c := range s.manifest.Collections {
		if c.Count != counts[k] {
			return nil, errors.New("corpus count mismatch")
		}
	}
	return s, nil
}
func (s *Store) Call(name string, raw json.RawMessage) (any, error) {
	if len(raw) > 8192 {
		return nil, errors.New("query too large")
	}
	var q Query
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if d.Decode(&q) != nil || d.Decode(new(any)) != io.EOF {
		return nil, errors.New("invalid query")
	}
	return s.Lookup(name, q)
}
func (s *Store) Lookup(name string, q Query) (Result, error) {
	r := Result{Status: "not_found", Version: s.manifest.Version, Coverage: map[string]Coverage{}, Entries: []Entry{}}
	bad := errors.New("invalid reference query")
	if len(q.ArabicQuery) > 1500 || len(q.Reference) > 80 {
		return r, bad
	}
	switch name {
	case "quran_fr":
		if q.Collection != "" || q.Reference != "" {
			return r, bad
		}
		q.Collection = "quran"
		if q.Surah != 0 || q.Verse != 0 || q.EndVerse != 0 {
			if q.ArabicQuery != "" || q.Surah < 1 || q.Surah > 114 || q.Verse < 1 || q.Verse > 286 {
				return r, bad
			}
			if q.EndVerse == 0 {
				q.EndVerse = q.Verse
			}
			if q.EndVerse < q.Verse || q.EndVerse-q.Verse >= 10 || q.EndVerse > 286 {
				return r, bad
			}
			q.Reference = strconv.Itoa(q.Surah) + ":" + strconv.Itoa(q.Verse)
		}
	case "sahih_ar":
		if q.Collection != "bukhari" && q.Collection != "muslim" {
			return r, bad
		}
	case "hadith_ar":
		if q.Collection == "" || q.Collection == "bukhari" || q.Collection == "muslim" || q.Collection == "quran" {
			return r, bad
		}
	default:
		return r, errors.New("unknown reference tool")
	}
	if name != "quran_fr" && (q.Surah != 0 || q.Verse != 0 || q.EndVerse != 0) {
		return r, bad
	}
	if (q.Reference == "") == (strings.TrimSpace(q.ArabicQuery) == "") {
		return r, bad
	}
	coverage, ok := s.manifest.Collections[q.Collection]
	if !ok {
		r.Status = "corpus_unavailable"
		return r, nil
	}
	r.Coverage[q.Collection] = coverage
	if q.Reference != "" {
		refs := []string{q.Reference}
		if name == "quran_fr" {
			refs = nil
			for v := q.Verse; v <= q.EndVerse; v++ {
				refs = append(refs, strconv.Itoa(q.Surah)+":"+strconv.Itoa(v))
			}
		}
		for _, ref := range refs {
			ids := s.byReference[q.Collection+":"+ref]
			if len(ids) == 0 {
				if variants := s.byFamily[q.Collection+":"+ref]; len(variants) > 0 {
					r.Status = "ambiguous"
					r.Match = "reference_variants"
					r.More = len(variants) > 5
					for _, i := range variants[:min(5, len(variants))] {
						r.Entries = append(r.Entries, s.entries[i])
					}
					return r, nil
				}
				r.Entries = []Entry{}
				return r, nil
			}
			for _, i := range ids {
				r.Entries = append(r.Entries, s.entries[i])
			}
		}
		r.Status = "found"
		r.Match = "exact_reference"
		if len(r.Entries) > len(refs) {
			r.Status = "ambiguous"
		}
		return r, nil
	}
	n := Normalize(q.ArabicQuery)
	words := strings.Fields(n)
	if len(words) < 3 {
		return r, bad
	}
	unique := map[string]bool{}
	hits := map[int]int{}
	for _, w := range words {
		if unique[w] {
			continue
		}
		unique[w] = true
		for _, i := range s.byWord[w] {
			if s.entries[i].Collection == q.Collection {
				hits[i]++
			}
		}
	}
	type hit struct {
		i, score int
		exact    bool
	}
	matches := []hit{}
	for i, count := range hits {
		exact := strings.Contains(" "+s.normalized[i]+" ", " "+n+" ")
		if exact || (count >= 3 && count*100 >= len(unique)*70) {
			matches = append(matches, hit{i, count, exact})
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		a, b := matches[i], matches[j]
		if a.exact != b.exact {
			return a.exact
		}
		if a.score != b.score {
			return a.score > b.score
		}
		return a.i < b.i
	})
	if len(matches) == 0 {
		return r, nil
	}
	// Even a unique normalized fragment is a candidate: diacritics, variants and
	// repetitions mean textual matching alone cannot certify the spoken citation.
	r.Status = "ambiguous"
	r.Match = "text_candidates"
	r.More = len(matches) > 5
	for _, m := range matches[:min(5, len(matches))] {
		r.Entries = append(r.Entries, s.entries[m.i])
	}
	return r, nil
}
func (s *Store) Tools() []any {
	str := func(desc string) any { return map[string]any{"type": "string", "description": desc} }
	makeTool := func(name, description string, p map[string]any, required []string) any {
		return map[string]any{"type": "function", "function": map[string]any{"name": name, "description": description, "parameters": map[string]any{"type": "object", "additionalProperties": false, "properties": p, "required": required}}}
	}
	return []any{
		makeTool("quran_fr", "Référence coranique locale : sourate/verset (plage maximale 10), OU fragment arabe. Renvoie l'arabe et le français de l'édition. Les candidats textuels exigent vérification. Ne complète pas une citation partielle.", map[string]any{
			"surah":        map[string]any{"type": "integer", "minimum": 1, "maximum": 114, "description": "Numéro de sourate ; uniquement pour une référence exacte."},
			"verse":        map[string]any{"type": "integer", "minimum": 1, "maximum": 286, "description": "Numéro du verset demandé, ou premier verset de la plage."},
			"end_verse":    map[string]any{"type": "integer", "minimum": 1, "maximum": 286, "description": "Facultatif : numéro du dernier verset, jamais un nombre de versets. Omettre pour un seul verset. Si présent : verse <= end_verse <= verse+9."},
			"arabic_query": str("Recherche par fragment d'au moins trois mots : fournir UNIQUEMENT arabic_query. Pour une référence exacte : omettre arabic_query et fournir surah/verse, sans end_verse pour un seul verset."),
		}, []string{}),
		makeTool("sahih_ar", "Bukhari ou Muslim : arabe uniquement, à traduire. Numérotation de l'édition retournée ; un numéro n'est pas nécessairement une référence Sunnah.com. Référence exacte OU fragment.", map[string]any{"collection": map[string]any{"type": "string", "enum": []string{"bukhari", "muslim"}}, "reference": str("Identifiant exact de l'édition locale"), "arabic_query": str("Fragment arabe, au moins trois mots")}, []string{"collection"}),
		makeTool("hadith_ar", "Autres recueils arabes installés : référence OU fragment. corpus_unavailable si recueil absent. Le modèle traduit lui-même l'arabe.", map[string]any{"collection": str("Nom du recueil local, par exemple abudawud, riyadussalihin"), "reference": str("Identifiant exact de l'édition locale"), "arabic_query": str("Fragment arabe, au moins trois mots")}, []string{"collection"}),
	}
}
