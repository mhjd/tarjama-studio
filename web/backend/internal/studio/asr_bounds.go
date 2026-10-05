package studio

import (
	"errors"
	"log"
	"math"
	"strings"
)

// Provider segment timestamps can extend beyond the supplied audio. Recover
// only when the word alignment accounts for every word of that segment. Words
// starting outside the audio cannot describe this chunk; never invent times or
// discard unaccounted text to make a malformed response pass validation.
func prepareASRChunk(c ASRChunk) ([]ASRSegment, error) {
	if math.IsNaN(c.Duration) || math.IsInf(c.Duration, 0) || c.Duration <= 0 {
		return nil, errors.New("Timestamp Groq hors morceau")
	}
	if _, err := PrepareASR(c.Response); err != nil {
		return nil, err
	}
	bounded := c.Response
	bounded.Words = append([]ASRWord(nil), c.Response.Words...)
	bounded.Segments = make([]ASRSegment, 0, len(c.Response.Segments))
	removed := 0
	for _, segment := range c.Response.Segments {
		if segment.End <= c.Duration+1 {
			bounded.Segments = append(bounded.Segments, segment)
			continue
		}
		var allText, keptText []string
		var kept []ASRWord
		previousStart, previousEnd := -1., -1.
		for wordIndex, word := range c.Response.Words {
			midpoint := (word.Start + word.End) / 2
			if midpoint < segment.Start || midpoint > segment.End {
				continue
			}
			if math.IsNaN(word.Start) || math.IsInf(word.Start, 0) || math.IsNaN(word.End) || math.IsInf(word.End, 0) || word.Start < 0 || word.End <= word.Start || word.Start < previousStart || word.End < previousEnd || strings.TrimSpace(word.Word) == "" {
				return nil, errors.New("Timestamp Groq hors morceau")
			}
			previousStart, previousEnd = word.Start, word.End
			allText = append(allText, strings.TrimSpace(word.Word))
			if word.Start >= c.Duration {
				removed++
				continue
			}
			word.End = math.Min(word.End, c.Duration)
			bounded.Words[wordIndex] = word
			kept = append(kept, word)
			keptText = append(keptText, strings.TrimSpace(word.Word))
		}
		if len(allText) == 0 || strings.Join(strings.Fields(segment.Text), " ") != strings.Join(allText, " ") {
			return nil, errors.New("Timestamp Groq hors morceau")
		}
		if len(kept) == 0 {
			continue
		}
		segment.Start, segment.End = kept[0].Start, kept[len(kept)-1].End
		segment.Text = strings.Join(keptText, " ")
		bounded.Segments = append(bounded.Segments, segment)
	}
	prepared, err := PrepareASR(bounded)
	if err != nil {
		return nil, err
	}
	// Validate prepared word groups as well as original segment timestamps.
	for _, segment := range prepared {
		if math.IsNaN(segment.Start) || math.IsInf(segment.Start, 0) || math.IsNaN(segment.End) || math.IsInf(segment.End, 0) || segment.Start < 0 || segment.End < segment.Start {
			return nil, errors.New("Segment Groq invalide")
		}
		if segment.End > c.Duration+1 {
			return nil, errors.New("Timestamp Groq hors morceau")
		}
	}
	if removed > 0 {
		log.Printf("ASR out-of-audio words omitted start=%g duration=%g words=%d", c.Start, c.Duration, removed)
	}
	return prepared, nil
}
