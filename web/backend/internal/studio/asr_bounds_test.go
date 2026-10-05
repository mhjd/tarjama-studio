package studio

import (
	"context"
	"github.com/jackc/pgx/v5"
	"math"
	"reflect"
	"testing"
)

func TestASRFinalChunkOutOfAudioWords(t *testing.T) {
	// Incident shape: 546.056s of audio, final segment until 554.5216s,
	// all three aligned words begin after the audio ends. No customer text.
	response := ASRResponse{Segments: []ASRSegment{
		{Start: 10, End: 12, Text: "مرحبا"},
		{Start: 524.5416, End: 554.5216, Text: "كلمة خارج الصوت"},
	}, Words: []ASRWord{
		{Start: 10, End: 12, Word: "مرحبا"},
		{Start: 553.9816, End: 554.00165, Word: "كلمة"},
		{Start: 554.00165, End: 554.0216, Word: "خارج"},
		{Start: 554.0216, End: 554.18164, Word: "الصوت"},
	}}
	before := append([]ASRSegment(nil), response.Segments...)
	beforeWords := append([]ASRWord(nil), response.Words...)
	out, err := MergeASR([]ASRChunk{{Start: 3480, Duration: 546.056, Response: response}}, 4026056)
	if err != nil || len(out) != 1 || out[0].Start != 3490000 || out[0].End != 3492000 || out[0].Arabic != "مرحبا" {
		t.Fatalf("%+v %v", out, err)
	}
	if !reflect.DeepEqual(response.Segments, before) || !reflect.DeepEqual(response.Words, beforeWords) {
		t.Fatal("raw provider response modified")
	}
}

func TestASRBoundaryKeepsInAudioWords(t *testing.T) {
	out, err := MergeASR([]ASRChunk{{Duration: 10, Response: ASRResponse{
		Segments: []ASRSegment{{Start: 8, End: 14, Text: "مرحبا بكم خارج"}},
		Words:    []ASRWord{{Start: 8, End: 9, Word: "مرحبا"}, {Start: 9, End: 10.2, Word: "بكم"}, {Start: 12, End: 14, Word: "خارج"}},
	}}}, 10000)
	if err != nil || len(out) != 1 || out[0].Start != 8000 || out[0].End != 10000 || out[0].Arabic != "مرحبا بكم" {
		t.Fatalf("%+v %v", out, err)
	}
}

func TestASRBoundaryRefusesUnaccountedText(t *testing.T) {
	for _, words := range [][]ASRWord{nil, {{Start: 12, End: 13, Word: "ناقص"}}, {{Start: math.NaN(), End: 13, Word: "كلام"}}, {{Start: 12, End: 13, Word: "كلام"}, {Start: 11, End: 12, Word: "كامل"}}} {
		_, err := MergeASR([]ASRChunk{{Duration: 10, Response: ASRResponse{Segments: []ASRSegment{{Start: 8, End: 14, Text: "كلام كامل"}}, Words: words}}}, 10000)
		if err == nil {
			t.Fatal("ambiguous or invalid alignment accepted")
		}
	}
}

func TestASRBoundaryDoesNotPublishEmptyTranscript(t *testing.T) {
	_, err := MergeASR([]ASRChunk{{Duration: 10, Response: ASRResponse{Segments: []ASRSegment{{Start: 12, End: 14, Text: "خارج"}}, Words: []ASRWord{{Start: 12, End: 14, Word: "خارج"}}}}}, 10000)
	if err == nil {
		t.Fatal("entirely out-of-audio response published")
	}
}

func TestASRBoundaryKeepsOrdinaryOverlap(t *testing.T) {
	out, err := MergeASR([]ASRChunk{
		{Duration: 40, Response: ASRResponse{Segments: []ASRSegment{{Start: 0, End: 5, Text: "أول"}, {Start: 20, End: 28, Text: "ثاني"}}}},
		{Start: 20, Duration: 40, Response: ASRResponse{Segments: []ASRSegment{{Start: 0, End: 8, Text: "ثاني"}, {Start: 8, End: 15, Text: "ثالث"}}}},
	}, 60000)
	if err != nil || len(out) != 3 || out[1].Start != 20000 || out[2].Start != 28000 {
		t.Fatalf("%+v %v", out, err)
	}
}

func TestASRBoundaryClampsCrossingWordBeforeGrouping(t *testing.T) {
	out, err := MergeASR([]ASRChunk{{Duration: 20, Response: ASRResponse{
		Segments: []ASRSegment{{Start: 5, End: 25, Text: "مرحبا بكم"}},
		Words:    []ASRWord{{Start: 5, End: 6, Word: "مرحبا"}, {Start: 18, End: 23, Word: "بكم"}},
	}}}, 20000)
	if err != nil || len(out) != 1 || out[0].Start != 5000 || out[0].End != 20000 || out[0].Arabic != "مرحبا بكم" {
		t.Fatalf("%+v %v", out, err)
	}
}

func TestASRWorkerResumesSavedBoundaryResponseWithoutProvider(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, p := fixture(t, s)
	p.Segments = nil
	p.Stage = "preparing"
	p.Duration = 15000
	_, err := s.Mutate(ctx, owner, p.ID, func(current *Project, tx pgx.Tx) error { *current = p; return enqueue(ctx, tx, owner, p, "transcribe") })
	if err != nil {
		t.Fatal(err)
	}
	chunks := []ASRChunk{
		{Duration: 10, Response: ASRResponse{Segments: []ASRSegment{{Start: 0, End: 1, Text: "أول"}}}},
		{Start: 8, Duration: 7, Response: ASRResponse{Segments: []ASRSegment{{Start: 0, End: 1, Text: "ثاني"}, {Start: 1, End: 10, Text: "خارج"}}, Words: []ASRWord{{Start: 8, End: 9, Word: "خارج"}}}},
	}
	for i, chunk := range chunks {
		job, e := s.Claim(ctx)
		if e != nil {
			t.Fatal(e)
		}
		if e = s.Chunk(ctx, job, i, chunk, GroqModel, "asr-desktop-v1", 99); e != nil {
			t.Fatal(e)
		}
	}
	// Providers and Media deliberately nil: only resume the durable assembly.
	worker := &Worker{Store: s}
	worked, err := worker.Once(ctx)
	if err != nil || !worked {
		t.Fatal(worked, err)
	}
	saved, err := s.Get(ctx, owner, p.ID)
	if err != nil || saved.Stage != "cleaning" || len(saved.Segments) != 2 || saved.Segments[1].Arabic != "ثاني" {
		t.Fatal(saved, err)
	}
	jobs, err := s.Jobs(ctx, owner, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	succeeded, next := false, false
	for _, job := range jobs {
		if job.Kind == "transcribe" && job.State == "succeeded" && job.Progress == 100 {
			succeeded = true
		}
		if job.Kind == "cleanup" && job.State == "queued" {
			next = true
		}
	}
	if !succeeded || !next {
		t.Fatal("durable assembly did not finish or queue next stage", jobs)
	}
}

func TestASRBoundaryRejectsInvalidDuration(t *testing.T) {
	for _, duration := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		if _, err := prepareASRChunk(ASRChunk{Duration: duration, Response: ASRResponse{Segments: []ASRSegment{{Start: 0, End: 1, Text: "مرحبا"}}}}); err == nil {
			t.Fatal("invalid chunk duration accepted")
		}
	}
}
