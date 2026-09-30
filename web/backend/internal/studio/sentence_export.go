package studio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"
)

// One bounded helper at a time per service, leaving memory for the API/worker.
// It receives text only, no paths, credentials or provider access.
var subtitleLayoutSlot = make(chan struct{}, 1)

type sentenceCue struct {
	First      int      `json:"first"`
	Last       int      `json:"last"`
	Start      int64    `json:"start_ms"`
	End        int64    `json:"end_ms"`
	Text       string   `json:"text"`
	Lines      []string `json:"lines"`
	Exceptions []string `json:"exceptions"`
}

func sentenceExportCues(ctx context.Context, segments []Segment, width, height int) ([]sentenceCue, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	select {
	case subtitleLayoutSlot <- struct{}{}:
		defer func() { <-subtitleLayoutSlot }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	source := make([]Segment, 0, len(segments))
	for _, s := range segments {
		s.French = strings.Join(strings.Fields(s.French), " ")
		if s.End > s.Start && s.French != "" {
			source = append(source, s)
		}
	}
	if len(source) == 0 {
		return nil, nil
	}
	input := struct {
		Segments []Segment `json:"segments"`
		Width    int       `json:"width"`
		Height   int       `json:"height"`
	}{source, width, height}
	data, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	if len(data) > 16*1024*1024 {
		return nil, errors.New("Sous-titres trop volumineux")
	}
	script := os.Getenv("SUBTITLE_LAYOUT_SCRIPT")
	if script == "" {
		script = "/app/subtitle-layout/main.py"
	}
	cmd := exec.CommandContext(ctx, "python3", "-B", script)
	// Deliberately do not inherit application secrets or proxy configuration.
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=C.UTF-8", "XDG_CACHE_HOME=/tmp"}
	cmd.Stdin = bytes.NewReader(data)
	var stdout limitedLayoutOutput
	cmd.Stdout = &stdout
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errors.New("Préparation des sous-titres indisponible")
	}
	var cues []sentenceCue
	if err := json.Unmarshal(stdout.Bytes(), &cues); err != nil {
		return nil, errors.New("Regroupement invalide")
	}
	next := 0
	for _, cue := range cues {
		if cue.First != next || cue.Last < next || cue.Last >= len(source) {
			return nil, errors.New("Regroupement incomplet")
		}
		texts := make([]string, 0, cue.Last-cue.First+1)
		for _, s := range source[cue.First : cue.Last+1] {
			texts = append(texts, s.French)
		}
		if cue.Start != source[cue.First].Start || cue.End != source[cue.Last].End || cue.Text != strings.Join(texts, " ") || strings.Join(cue.Lines, " ") != cue.Text {
			return nil, errors.New("Regroupement altérant les sous-titres")
		}
		next = cue.Last + 1
	}
	if next != len(source) {
		return nil, errors.New("Regroupement incomplet")
	}
	return cues, nil
}

type limitedLayoutOutput struct{ bytes.Buffer }

func (b *limitedLayoutOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 32*1024*1024 {
		return 0, errors.New("Regroupement trop volumineux")
	}
	return b.Buffer.Write(p)
}

func groupedSRT(ctx context.Context, segments []Segment, track string) (string, error) {
	if track != "fr" {
		return SRT(segments, track), nil
	}
	groups, err := sentenceExportCues(ctx, segments, 1920, 1080)
	if err != nil {
		return "", err
	}
	cues := make([]exportCue, 0, len(groups))
	for _, g := range groups {
		cues = append(cues, exportCue{g.Start, g.End, strings.Join(g.Lines, "\n")})
	}
	return renderSRT(cues), nil
}

func groupedASS(ctx context.Context, segments []Segment, width, height int, track string) (string, error) {
	if track != "fr" {
		return ASS(segments, width, height, track), nil
	}
	groups, err := sentenceExportCues(ctx, segments, width, height)
	if err != nil {
		return "", err
	}
	cues := make([]exportCue, 0, len(groups))
	for _, g := range groups {
		text := g.Text
		if len(g.Exceptions) == 0 {
			text = strings.Join(g.Lines, "\n")
		}
		cues = append(cues, exportCue{g.Start, g.End, text})
	}
	return renderASS(cues, width, height, track), nil
}
