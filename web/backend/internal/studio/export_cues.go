package studio

import (
	"strings"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// Video-only cues: grouping must never change the saved editing segments or SRT.
type exportCue struct {
	Start, End int64 // milliseconds
	Text       string
}

// Port of automatic groupExportCues in ui/electron/export-options.ts.
// Millisecond comparisons avoid floating point ambiguity at the boundaries.
func (c exportCue) needsMerge() bool {
	return len(strings.Fields(c.Text)) <= 2 || (c.End-c.Start)*6 < 5000
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
		for i+1 < len(cues) && current.needsMerge() && canMergeExportCues(current, cues[i+1]) {
			i++
			current.End = cues[i].End
			current.Text += " " + cues[i].Text
		}
		if n := len(grouped); n > 0 && current.needsMerge() && canMergeExportCues(grouped[n-1], current) {
			grouped[n-1].End = current.End
			grouped[n-1].Text += " " + current.Text
		} else {
			grouped = append(grouped, current)
		}
	}
	return grouped
}
