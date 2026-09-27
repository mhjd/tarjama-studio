package studio

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5"
	"strings"
	"testing"
)

func TestSubtitlesWithoutMediaAndAfterArabicEdit(t *testing.T) {
	s := testStore(t)
	owner, p := fixture(t, s)
	_, server := testAPI(t, s)
	token, csrf := sessionFor(t, s, owner)
	_, e := s.Mutate(context.Background(), owner, p.ID, func(p *Project, _ pgx.Tx) error {
		p.Stage = "review"
		p.TranslationSource = p.ArabicVersion
		p.Segments[0].Start = 3601123
		p.Segments[0].End = 3602456
		p.Segments[1].Start = 3602456
		p.Segments[1].End = 3603000
		for i := range p.Segments {
			p.Segments[i].French = "Une traduction corrigée."
		}
		return nil
	})
	if e != nil {
		t.Fatal(e)
	}
	path := "/api/projects/" + p.ID
	for _, track := range []string{"ar", "fr"} {
		status, b := call(t, server, token, csrf, "GET", path+"/subtitles/"+track+".srt?version=1", nil)
		if status != 200 || !strings.Contains(string(b), "01:00:01,123 --> 01:00:02,456") {
			t.Fatal(status, string(b))
		}
	}
	status, _ := call(t, server, token, csrf, "PATCH", path+"/segments/one", map[string]any{"version": 1, "field": "arabic", "text": "نص مصحح"})
	if status != 200 {
		t.Fatal(status)
	}
	status, b := call(t, server, token, csrf, "GET", path+"/subtitles/fr.srt?version=2", nil)
	if status != 200 || !strings.Contains(string(b), "Une traduction corrigée.") {
		t.Fatal(status, string(b))
	}
	status, _ = call(t, server, token, csrf, "GET", path+"/subtitles/fr.srt?version=1", nil)
	if status != 409 {
		t.Fatal("stale version", status)
	}
	other, _ := s.User(context.Background(), "test", "other")
	otherToken, otherCSRF := sessionFor(t, s, other)
	status, _ = call(t, server, otherToken, otherCSRF, "GET", path+"/subtitles/fr.srt?version=2", nil)
	if status != 404 {
		t.Fatal("cross user", status)
	}
	for _, stage := range []string{"cleaning", "transcribing", "translating"} {
		s.Mutate(context.Background(), owner, p.ID, func(p *Project, _ pgx.Tx) error { p.Stage = stage; return nil })
		status, _ = call(t, server, token, csrf, "GET", fmt.Sprintf("%s/subtitles/fr.srt?version=2", path), nil)
		if status != 409 {
			t.Fatal(stage, status)
		}
	}
}
func TestSRTMultiline(t *testing.T) {
	got := SRT([]Segment{{Start: 0, End: 1234, French: "Une ligne\r\n\r\nUne autre", Arabic: "سلام"}}, "fr")
	if got != "1\r\n00:00:00,000 --> 00:00:01,234\r\nUne ligne\r\nUne autre\r\n\r\n" {
		t.Fatal(got)
	}
}
