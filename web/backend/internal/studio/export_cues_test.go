package studio

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// Compare actual decoded video pixels against an explicitly joined reference.
// This catches a render path that accidentally bypasses the grouped ASS cues.
func TestGroupedVideoMatchesJoinedReference(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg required")
	}
	dir := t.TempDir()
	source := filepath.Join(dir, "source.mp4")
	mediaTestCommand(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=0x31453b:s=640x360:d=4", "-f", "lavfi", "-i", "sine=duration=4", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", "-shortest", source)
	inputs := [][]Segment{
		{{ID: "one", Start: 0, End: 2000, Arabic: "نعم", French: "en disant : « Sans la difficulté,"}, {ID: "two", Start: 2000, End: 4000, Arabic: "هذا الشرح ضروري", French: "tout le monde serait chef. »"}},
		{{ID: "one", Start: 0, End: 4000, Arabic: "نعم هذا الشرح ضروري", French: "en disant : « Sans la difficulté, tout le monde serait chef. »"}},
	}
	var reference []byte
	for i, segments := range inputs {
		output := filepath.Join(dir, "render.mp4")
		if i > 0 {
			if err := os.Remove(output); err != nil {
				t.Fatal(err)
			}
		}
		_, err := (LocalMedia{Test: true}).Process(context.Background(), MediaRequest{Operation: "export", Track: "fr", Quality: "high", Segments: segments}, source, output)
		if err != nil {
			t.Fatal(err)
		}
		frame, err := exec.Command("ffmpeg", "-v", "error", "-ss", "1", "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-").Output()
		if err != nil || len(frame) != 640*360*3 {
			t.Fatal("decode render", err, len(frame))
		}
		if i == 0 {
			reference = frame
			if dest := os.Getenv("MEDIA_TEST_ARTIFACTS"); dest != "" {
				if err := os.MkdirAll(dest, 0700); err != nil {
					t.Fatal(err)
				}
				data, err := os.ReadFile(output)
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(dest, "grouped-fr-high.mp4"), data, 0600); err != nil {
					t.Fatal(err)
				}
			}
		} else if !bytes.Equal(reference, frame) {
			t.Fatal("grouped video differs from joined reference")
		}
	}
}

func TestAutomaticExportCuePairs(t *testing.T) {
	for _, tc := range []struct {
		name  string
		input []exportCue
		want  []exportCue
	}{
		{"flash", []exportCue{{0, 700, "En effet"}, {750, 3500, "cette explication reste nécessaire."}}, []exportCue{{0, 3500, "En effet cette explication reste nécessaire."}}},
		{"pause", []exportCue{{0, 700, "En effet"}, {1300, 4000, "cette explication arrive après une pause."}}, []exportCue{{0, 700, "En effet"}, {1300, 4000, "cette explication arrive après une pause."}}},
		{"too fast", []exportCue{{0, 500, "Oui"}, {500, 1000, "Cette phrase est beaucoup trop longue pour être fusionnée et lue correctement."}}, []exportCue{{0, 500, "Oui"}, {500, 1000, "Cette phrase est beaucoup trop longue pour être fusionnée et lue correctement."}}},
		{"two short sentences", []exportCue{{0, 3000, "Une phrase complète."}, {3000, 4000, "Oui."}}, []exportCue{{0, 4000, "Une phrase complète. Oui."}}},
		{"chain", []exportCue{{0, 1000, "Une"}, {1000, 2000, "petite"}, {2000, 3000, "phrase"}, {3000, 5000, "Une autre phrase."}}, []exportCue{{0, 2000, "Une petite"}, {2000, 5000, "phrase Une autre phrase."}}},
		{"hour offset and empty", []exportCue{{3600000, 3600700, "  En effet "}, {3600700, 3600750, " "}, {3600750, 3603500, "cette explication reste nécessaire."}, {3603500, 3603500, "invalide"}}, []exportCue{{3600000, 3603500, "En effet cette explication reste nécessaire."}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			segments := make([]Segment, len(tc.input))
			for i, cue := range tc.input {
				segments[i] = Segment{Start: cue.Start, End: cue.End, French: cue.Text}
			}
			if got := automaticExportCues(segments, "fr"); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %#v, want %#v", got, tc.want)
			}
		})
	}
}

func TestExportCueReadingBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name        string
		left, right exportCue
		merge       bool
	}{
		{"gap 500ms", exportCue{0, 1000, "Oui"}, exportCue{1500, 3000, "à tous"}, true},
		{"gap 501ms", exportCue{0, 1000, "Oui"}, exportCue{1501, 3000, "à tous"}, false},
		{"overlap 10ms", exportCue{0, 1000, "Oui"}, exportCue{990, 3000, "à tous"}, true},
		{"overlap 11ms", exportCue{0, 1000, "Oui"}, exportCue{989, 3000, "à tous"}, false},
		{"duration 7s", exportCue{0, 1000, "Oui"}, exportCue{1000, 7000, "à tous"}, true},
		{"duration beyond 7s", exportCue{0, 1000, "Oui"}, exportCue{1000, 7001, "à tous"}, false},
		{"84 characters", exportCue{0, 1000, "Oui"}, exportCue{1000, 7000, strings.Repeat("é", 80)}, true},
		{"85 characters", exportCue{0, 1000, "Oui"}, exportCue{1000, 7000, strings.Repeat("é", 81)}, false},
		{"NFC count", exportCue{0, 1000, "Oui"}, exportCue{1000, 7000, strings.Repeat("e\u0301", 80)}, true},
		{"17 characters per second", exportCue{0, 500, "Oui"}, exportCue{500, 1000, strings.Repeat("ع", 13)}, true},
		{"18 characters per second", exportCue{0, 500, "Oui"}, exportCue{500, 1000, strings.Repeat("ع", 14)}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := canMergeExportCues(tc.left, tc.right); got != tc.merge {
				t.Fatalf("merge = %v, want %v", got, tc.merge)
			}
		})
	}
}

func TestGroupedExportsKeepEditingSegments(t *testing.T) {
	segments := []Segment{
		{ID: "first", Start: 3600000, End: 3600700, French: "En effet", Arabic: "هذا نص طويل"},
		{ID: "second", Start: 3600750, End: 3605000, French: "cette explication reste nécessaire.", Arabic: "هذه عبارة أخرى"},
	}
	original := append([]Segment(nil), segments...)
	ass := ASS(segments, 1280, 720, "fr")
	if strings.Count(ass, "Dialogue: ") != 1 || !strings.Contains(ass, "1:00:00.00,1:00:05.00,Default,,0,0,0,,En effet cette explication reste nécessaire.") {
		t.Fatal(ass)
	}
	if cues := automaticExportCues(segments, "ar"); len(cues) != 1 || cues[0].Text != "هذا نص طويل هذه عبارة أخرى" {
		t.Fatal("Arabic short duration grouping", cues)
	}
	if !reflect.DeepEqual(segments, original) {
		t.Fatal("export changed saved segments")
	}
	if srt := SRT(segments, "fr"); strings.Count(srt, " --> ") != 1 || !strings.Contains(srt, "01:00:00,000 --> 01:00:05,000\r\nEn effet cette explication reste nécessaire.") {
		t.Fatal("SRT must match grouped video cues", srt)
	}
	if !reflect.DeepEqual(segments, original) {
		t.Fatal("SRT export changed saved segments")
	}
	escaped := ASS([]Segment{{Start: 0, End: 2000, French: "{\\pos(1,2)}\nSalut"}}, 1280, 720, "fr")
	if !strings.Contains(escaped, "｛＼pos(1,2)｝\\NSalut") {
		t.Fatal("ASS escaping lost", escaped)
	}
}

func TestShortPhraseExportGrouping(t *testing.T) {
	segments := []Segment{
		{ID: "a", Start: 1450000, End: 1452000, French: "en disant : « Sans la difficulté,", Arabic: "بقوله : لولا المشقة"},
		{ID: "b", Start: 1452000, End: 1454000, French: "tout le monde serait chef. »", Arabic: "ساد الناس كلهم."},
	}
	before := append([]Segment(nil), segments...)
	for _, track := range []string{"fr", "ar"} {
		cues := automaticExportCues(segments, track)
		if len(cues) != 1 || cues[0].Start != 1450000 || cues[0].End != 1454000 {
			t.Fatalf("%s: %#v", track, cues)
		}
		if got := SRT(segments, track); strings.Count(got, " --> ") != 1 || !strings.Contains(got, "00:24:10,000 --> 00:24:14,000") {
			t.Fatal(got)
		}
		if got := ASS(segments, 1280, 720, track); strings.Count(got, "Dialogue: ") != 1 || !strings.Contains(got, "0:24:10.00,0:24:14.00") {
			t.Fatal(got)
		}
	}
	if !reflect.DeepEqual(before, segments) {
		t.Fatal("review segments modified")
	}
}

func TestExportPairWordLimit(t *testing.T) {
	nine := "un un un un un un un un un"
	ten := nine + " un"
	for _, tc := range []struct {
		name, left, right string
		count             int
	}{
		{"nine and nine", nine, nine, 1},
		{"nine and ten", nine, ten, 2},
		{"ten and nine", ten, nine, 2},
		{"tiny followed by ten", "Oui", ten, 2},
		{"ten followed by tiny", ten, "Oui", 2},
		{"punctuation is not a word", "« " + nine + " »", "Oui.", 1},
		{"arabic", "واحد اثنان ثلاثة أربعة خمسة ستة سبعة ثمانية تسعة", "نعم", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			segments := []Segment{{Start: 0, End: 2000, French: tc.left}, {Start: 2000, End: 4000, French: tc.right}}
			if got := automaticExportCues(segments, "fr"); len(got) != tc.count {
				t.Fatalf("got %#v", got)
			}
		})
	}
	for _, tc := range []struct {
		name                 string
		rightStart, rightEnd int64
		rightText            string
	}{
		{"pause", 2600, 4600, "tout le monde serait chef. »"},
		{"too fast", 500, 1000, "tout le monde serait chef. »"},
		{"long text despite few words", 2000, 6000, strings.Repeat("a", 85)},
		{"too long duration", 2000, 7001, "tout le monde serait chef. »"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			end := int64(2000)
			if tc.rightStart < end {
				end = tc.rightStart
			}
			segments := []Segment{{Start: 0, End: end, French: "en disant : « Sans la difficulté,"}, {Start: tc.rightStart, End: tc.rightEnd, French: tc.rightText}}
			if got := automaticExportCues(segments, "fr"); len(got) != 2 {
				t.Fatalf("unexpected merge: %#v", got)
			}
		})
	}
}
