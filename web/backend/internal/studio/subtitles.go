package studio

import (
	"fmt"
	"mime"
	"net/http"
	"strconv"
	"strings"
)

func srtTime(ms int64) string {
	return fmt.Sprintf("%02d:%02d:%02d,%03d", ms/3600000, ms/60000%60, ms/1000%60, ms%1000)
}

// Plain UTF-8 SubRip, without ASS styling or additional invented timestamps.
func SRT(segments []Segment, track string) string {
	var out strings.Builder
	for i, s := range segments {
		text := s.French
		if track == "ar" {
			text = s.Arabic
		}
		// Blank lines delimit cues in SRT; collapse them inside a subtitle.
		lines := strings.FieldsFunc(text, func(r rune) bool { return r == '\r' || r == '\n' })
		fmt.Fprintf(&out, "%d\r\n%s --> %s\r\n%s\r\n\r\n", i+1, srtTime(s.Start), srtTime(s.End), strings.Join(lines, "\r\n"))
	}
	return out.String()
}
func (a *API) subtitles(w http.ResponseWriter, r *http.Request) {
	p, err := a.Store.Get(r.Context(), who(r).User, r.PathValue("id"))
	if err != nil {
		apiError(w, err)
		return
	}
	track := r.PathValue("track")
	if track != "ar.srt" && track != "fr.srt" {
		apiError(w, ErrMissing)
		return
	}
	lang := strings.TrimSuffix(track, ".srt")
	version, err := strconv.ParseInt(r.URL.Query().Get("version"), 10, 64)
	if err != nil || version != p.Version {
		apiError(w, ErrConflict)
		return
	}
	if err := ValidateSegments(p.Segments); err != nil {
		apiError(w, err)
		return
	}
	if p.Stage != "arabic" && p.Stage != "review" && p.Stage != "ready" && !(lang == "ar" && p.Stage == "translating") {
		http.Error(w, "Attendez la fin du traitement", 409)
		return
	}
	if lang == "fr" {
		if p.TranslationSource == 0 || p.Stage == "translating" {
			http.Error(w, "Traduction indisponible", 409)
			return
		}
		for _, s := range p.Segments {
			if strings.TrimSpace(s.French) == "" {
				http.Error(w, "Traduction incomplète", 409)
				return
			}
		}
	}
	filename := strings.TrimSuffix(exportFilename(p.Title), ".mp4") + "_" + lang + ".srt"
	w.Header().Set("Content-Type", "application/x-subrip; charset=utf-8")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	w.Header().Set("Cache-Control", "no-store")
	fmt.Fprint(w, SRT(p.Segments, lang))
}
