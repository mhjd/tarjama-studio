package studio

import (
	"strings"
	"unicode"
)

// Match the desktop's title-derived names. Bound UTF-8 bytes (not just runes),
// keep Arabic/accents and exclude paths, controls and platform-reserved names.
// This is only a download label; private storage paths keep their opaque IDs.
func exportFilename(title string) string {
	var name strings.Builder
	separator := false
	for _, r := range title {
		if !unicode.IsLetter(r) && !unicode.IsNumber(r) && !unicode.IsMark(r) {
			separator = name.Len() > 0
			continue
		}
		if separator {
			name.WriteByte('_')
			separator = false
		}
		if name.Len()+len(string(r)) > 180 {
			break
		}
		name.WriteRune(r)
	}
	stem := strings.Trim(name.String(), "_")
	if stem == "" {
		stem = "Tarjama_Studio"
	}
	lower := strings.ToLower(stem)
	if lower == "con" || lower == "prn" || lower == "aux" || lower == "nul" ||
		(len(lower) == 4 && (strings.HasPrefix(lower, "com") || strings.HasPrefix(lower, "lpt")) && lower[3] >= '1' && lower[3] <= '9') {
		stem += "_video"
	}
	return stem + ".mp4"
}
