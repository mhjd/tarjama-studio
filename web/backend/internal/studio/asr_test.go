package studio

import (
	"math"
	"testing"
)

func TestASREmptySegmentRecoversBeforeValidation(t *testing.T) {
	input := ASRResponse{Segments: []ASRSegment{
		{Start: 290, End: 294, Text: "مرحبا بكم"},
		{Start: 294.43988, End: 313.49976, Text: "   "},
		{Start: 314, End: 316, Text: "السلام عليكم"},
		{Start: 316, End: 316, Text: "تكرار"},
	}, Words: []ASRWord{{Start: 295, End: 297, Word: "شكرا"}}}
	out, err := MergeASR([]ASRChunk{{Duration: 600, Response: input}}, 600000)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 3 || out[0].Start != 290000 || out[0].End != 294000 || out[1].Start != 295000 || out[1].End != 297000 || out[2].Start != 314000 || out[2].End != 316000 {
		t.Fatalf("valid speech/timestamps changed: %+v", out)
	}
	if out[0].Arabic != input.Segments[0].Text || out[1].Arabic != "شكرا" || out[2].Arabic != input.Segments[2].Text {
		t.Fatal("speech lost")
	}
}

func TestASREmptySegmentRecoversWordText(t *testing.T) {
	for _, end := range []float64{5, 20} {
		out, err := PrepareASR(ASRResponse{
			Segments: []ASRSegment{{Start: 0, End: end}},
			Words:    []ASRWord{{Start: 1, End: 2, Word: "مرحبا"}, {Start: 2, End: 3, Word: "بكم"}},
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(out) != 1 || out[0].Text != "مرحبا بكم" || out[0].Start != 1 || out[0].End != 3 {
			t.Fatalf("word recovery failed: %+v", out)
		}
	}
}

func TestASRUnrecoverableTextAndMalformedTimes(t *testing.T) {
	for _, segment := range []ASRSegment{{Start: 0, End: 20, Text: " "}, {Start: 0, End: 5}} {
		if _, err := PrepareASR(ASRResponse{Segments: []ASRSegment{segment}}); err == nil {
			t.Fatal("unrecoverable passage silently discarded")
		}
	}
	for _, s := range []ASRSegment{
		{Start: -1, End: 1}, {Start: 2, End: 1}, {Start: math.NaN(), End: 1}, {Start: 0, End: math.Inf(1)},
	} {
		s.Text = "مرحبا"
		if _, err := PrepareASR(ASRResponse{Segments: []ASRSegment{s}}); err == nil {
			t.Fatal("malformed timestamp accepted")
		}
	}
	if _, err := MergeASR([]ASRChunk{{Duration: 600, Response: ASRResponse{}}}, 600000); err == nil {
		t.Fatal("entirely empty transcript published")
	}
}
