package studio

import (
	"fmt"
	"strings"
	"testing"
)

// Independent expected values from Desktop large size /
// black-band in ui/electron/export-options.ts and library.ts writeAssSubtitles.
func TestASSMatchesDesktopLargeStyle(t *testing.T) {
	for _, tc := range []struct{ w, h, size, horizontal, vertical int }{
		{1920, 1080, 83, 96, 63}, {1280, 720, 55, 64, 42}, {854, 480, 37, 43, 28},
		{720, 1280, 55, 36, 74}, {1080, 1920, 83, 54, 111}, {640, 640, 49, 32, 37},
		{320, 240, 18, 20, 18},
	} {
		for _, track := range []string{"fr", "ar"} {
			t.Run(fmt.Sprintf("%dx%d-%s", tc.w, tc.h, track), func(t *testing.T) {
				got := ASS([]Segment{{ID: "a", Start: 0, End: 3000, Arabic: "مرحبا بكم", French: "Bonjour à tous."}}, tc.w, tc.h, track)
				font := "Arial"
				if track == "ar" {
					font = "Noto Naskh Arabic"
				}
				want := fmt.Sprintf("Style: Default,%s,%d,&H00FFFFFF,&H000000FF,&H00000000,&HC0000000,0,0,0,0,100,100,0,0,3,1,0,2,%d,%d,%d,1", font, tc.size, tc.horizontal, tc.horizontal, tc.vertical)
				if !strings.Contains(got, want+"\n") {
					t.Fatalf("desktop style differs; want %s; got %s", want, got)
				}
				if !strings.Contains(got, fmt.Sprintf("PlayResX: %d\nPlayResY: %d\nWrapStyle: 0\nScaledBorderAndShadow: yes", tc.w, tc.h)) {
					t.Fatal("reference resolution or wrapping differs", got)
				}
			})
		}
	}
}
