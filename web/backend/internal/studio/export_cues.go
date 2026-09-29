package studio

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// Shared video/SRT cues: grouping never changes the saved editing segments.
type exportCue struct {
	Start, End int64 // milliseconds
	Text       string
}

// Count whitespace-separated words containing a letter or digit: standalone
// quotation marks and punctuation are not words (in either language).
func exportWordCount(text string) int {
	count := 0
	for _, field := range strings.Fields(text) {
		for _, r := range field {
			if unicode.IsLetter(r) || unicode.IsNumber(r) {
				count++
				break
			}
		}
	}
	return count
}

func canMergeExportCues(left, right exportCue) bool {
	gap, duration := right.Start-left.End, right.End-left.Start
	if gap < -10 || gap > 500 || duration <= 0 || duration > 7000 {
		return false
	}
	characters := utf8.RuneCountInString(norm.NFC.String(left.Text + " " + right.Text))
	return characters <= 84 && int64(characters)*1000 <= duration*17
}

func automaticExportCues(segments []Segment, track string) []exportCue {
	cues := make([]exportCue, 0, len(segments))
	for _, segment := range segments {
		text := segment.Arabic
		if track == "fr" {
			text = segment.French
		}
		text = strings.TrimSpace(text)
		if text != "" && segment.End > segment.Start {
			cues = append(cues, exportCue{segment.Start, segment.End, text})
		}
	}
	grouped := make([]exportCue, 0, len(cues))
	for i := 0; i < len(cues); i++ {
		current := cues[i]
		// Pair original neighbours only; never grow a group by chaining merges.
		if i+1 < len(cues) && exportWordCount(current.Text) < 10 &&
			exportWordCount(cues[i+1].Text) < 10 && canMergeExportCues(current, cues[i+1]) {
			i++
			current.End = cues[i].End
			current.Text += " " + cues[i].Text
		}
		grouped = append(grouped, current)
	}
	return grouped
}
