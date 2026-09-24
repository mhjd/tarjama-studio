package studio

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

type Segment struct {
	ID      string `json:"id"`
	Start   int64  `json:"start_ms"`
	End     int64  `json:"end_ms"`
	Arabic  string `json:"arabic"`
	French  string `json:"french"`
	Version int64  `json:"version"`
}
type Project struct {
	ID                string    `json:"id"`
	Title             string    `json:"title"`
	URL               string    `json:"url,omitempty"`
	Stage             string    `json:"stage"`
	Version           int64     `json:"version"`
	ArabicVersion     int64     `json:"arabic_version"`
	ConfirmedArabic   int64     `json:"confirmed_arabic"`
	TranslationSource int64     `json:"translation_source"`
	ConfirmedReview   int64     `json:"confirmed_review"`
	Generation        int64     `json:"generation"`
	Media             string    `json:"media,omitempty"`
	Duration          int64     `json:"duration_ms"`
	Width             int       `json:"width"`
	Height            int       `json:"height"`
	Segments          []Segment `json:"segments"`
}
type Job struct {
	ID            string  `json:"id"`
	ProjectID     string  `json:"project_id"`
	Owner         string  `json:"-"`
	Kind          string  `json:"kind"`
	SourceVersion int64   `json:"source_version"`
	Generation    int64   `json:"generation"`
	Input         Project `json:"-"`
	State         string  `json:"state"`
	Lease         string  `json:"-"`
	Progress      int     `json:"progress"`
	Attempts      int     `json:"-"`
	MediaAttempt  int     `json:"-"`
	Message       string  `json:"message"`
	NextAttempt   string  `json:"next_attempt_at"`
}

var ErrConflict = errors.New("Le projet a changé dans une autre fenêtre. Votre saisie est conservée.")
var ErrMissing = errors.New("Ressource introuvable")

func id() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

var safeID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,160}$`)
var timecode = regexp.MustCompile(`^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$`)

func ParseTimecode(v string) (int64, error) {
	m := timecode.FindStringSubmatch(strings.TrimSpace(v))
	if m == nil {
		return 0, errors.New("Horodatage invalide")
	}
	h, _ := strconv.ParseFloat(m[1], 64)
	min, _ := strconv.ParseFloat(m[2], 64)
	s, _ := strconv.ParseFloat(m[3], 64)
	if min >= 60 || s >= 60 || math.IsInf(h, 0) || h > 100000 {
		return 0, errors.New("Horodatage invalide")
	}
	return int64(math.Round((h*3600 + min*60 + s) * 1000)), nil
}
func ValidateSegments(s []Segment) error {
	if len(s) == 0 || len(s) > 50000 {
		return errors.New("Nombre de segments invalide")
	}
	seen := map[string]bool{}
	for i, x := range s {
		if !safeID.MatchString(x.ID) || seen[x.ID] || x.Start < 0 || x.End <= x.Start || len(x.Arabic) > 16000 || strings.TrimSpace(x.Arabic) == "" || len(x.French) > 16000 {
			return fmt.Errorf("Segment %d invalide", i+1)
		}
		if i > 0 && x.Start < s[i-1].End {
			return errors.New("Segments qui se chevauchent")
		}
		seen[x.ID] = true
	}
	return nil
}
func VideoURL(raw string) (string, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || len(raw) > 2048 {
		return "", errors.New("Utilisez un lien YouTube HTTPS")
	}
	var video string
	switch strings.ToLower(u.Hostname()) {
	case "youtu.be":
		video = strings.TrimPrefix(u.Path, "/")
	case "www.youtube.com", "youtube.com", "m.youtube.com":
		if u.Path == "/watch" {
			video = u.Query().Get("v")
		} else if strings.HasPrefix(u.Path, "/shorts/") {
			video = strings.TrimPrefix(u.Path, "/shorts/")
		}
	}
	if !regexp.MustCompile(`^[a-zA-Z0-9_-]{11}$`).MatchString(video) {
		return "", errors.New("Lien YouTube vidéo invalide (les playlists ne sont pas prises en charge)")
	}
	return "https://www.youtube.com/watch?v=" + video, nil
}

// Text chunks target ten minutes; ASR keeps its own ten-minute overlap policy.
// Dense inputs may stop earlier: keep room for JSON IDs and expanded French text
// within the provider output budget. These are byte/count guards, not a tokenizer.
const textChunkDurationMS = 10 * 60 * 1000
const textChunkMaxSegments = 600
const textChunkMaxBytes = 64000

// Chunk only at segment boundaries; never split an individual subtitle.
func TextChunks(s []Segment) [][]Segment {
	var out [][]Segment
	for len(s) > 0 {
		n := 1
		chars := len(s[0].Arabic)
		for n < len(s) && n < textChunkMaxSegments && s[n].End-s[0].Start <= textChunkDurationMS && chars+len(s[n].Arabic) <= textChunkMaxBytes {
			chars += len(s[n].Arabic)
			n++
		}
		out = append(out, s[:n])
		s = s[n:]
	}
	return out
}
