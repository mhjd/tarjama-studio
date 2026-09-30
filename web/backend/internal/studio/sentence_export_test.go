package studio

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestSentenceExportWholePhraseAndSharedFormats(t *testing.T) {
	s := []Segment{{Start: 0, End: 1500, French: "La température"}, {Start: 1500, End: 3000, French: "augmente dans"}, {Start: 3000, End: 4500, French: "le récipient."}}
	before := append([]Segment(nil), s...)
	cues, err := sentenceExportCues(context.Background(), s, 1920, 1080)
	if err != nil || len(cues) != 1 || cues[0].Text != "La température augmente dans le récipient." {
		t.Fatalf("cues=%+v err=%v", cues, err)
	}
	srt, err := groupedSRT(context.Background(), s, "fr")
	if err != nil || strings.Count(srt, " --> ") != 1 {
		t.Fatalf("%s %v", srt, err)
	}
	for _, size := range [][2]int{{1920, 1080}, {854, 480}, {1080, 1920}} {
		ass, err := groupedASS(context.Background(), s, size[0], size[1], "fr")
		if err != nil || !strings.Contains(ass, "Dialogue: 0,0:00:00.00,0:00:04.50") {
			t.Fatalf("%v: %s %v", size, ass, err)
		}
	}
	if !reflect.DeepEqual(s, before) {
		t.Fatal("saved text changed")
	}
}

func TestSentenceExportCommaAndBalance(t *testing.T) {
	for _, tc := range []struct {
		texts    []string
		duration int64
		firstEnd int64
	}{
		{[]string{"Après la mesure,", "la température augmente", "dans la pièce."}, 2500, 2500},
		{[]string{"Nous", "observons une variation", "de température notable", "ce matin."}, 2000, 4000},
	} {
		s := []Segment{}
		for i, text := range tc.texts {
			s = append(s, Segment{Start: int64(i) * tc.duration, End: int64(i+1) * tc.duration, French: text})
		}
		cues, err := sentenceExportCues(context.Background(), s, 1920, 1080)
		if err != nil || len(cues) != 2 || cues[0].End != tc.firstEnd {
			t.Fatalf("%+v %v", cues, err)
		}
	}
}

func TestSentenceExportFailureDoesNotSilentlyUsePairs(t *testing.T) {
	t.Setenv("SUBTITLE_LAYOUT_SCRIPT", "/missing/subtitle-layout.py")
	s := []Segment{{Start: 0, End: 3000, French: "Bonjour."}}
	if _, err := groupedSRT(context.Background(), s, "fr"); err == nil {
		t.Fatal("missing helper accepted")
	}
	if _, err := groupedASS(context.Background(), s, 1920, 1080, "fr"); err == nil {
		t.Fatal("missing helper accepted")
	}
}

func TestSentenceExportCancellationAndEscaping(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s := []Segment{{Start: 0, End: 3000, French: "{\\pos(1,2)} Bonjour."}}
	if _, err := groupedSRT(ctx, s, "fr"); err == nil {
		t.Fatal("cancellation ignored")
	}
	ass, err := groupedASS(context.Background(), s, 1920, 1080, "fr")
	if err != nil || strings.Contains(ass, "{\\pos") || !strings.Contains(ass, "｛＼pos") {
		t.Fatalf("%s %v", ass, err)
	}
}
