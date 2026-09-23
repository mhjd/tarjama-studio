package studio

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"math"
	"net/http"
	"os"
	"strings"
	"time"
)

type Worker struct {
	Store     *Store
	Config    Config
	Providers Providers
	Media     Media
}
type ASRChunk struct {
	Start    float64         `json:"start"`
	Duration float64         `json:"duration"`
	Response ASRResponse     `json:"response"`
	Raw      json.RawMessage `json:"raw"`
}

func PrepareASR(response ASRResponse) ([]ASRSegment, error) {
	out := []ASRSegment{}
	for _, s := range response.Segments {
		if math.IsNaN(s.Start) || math.IsInf(s.Start, 0) || math.IsNaN(s.End) || math.IsInf(s.End, 0) || s.Start < 0 || s.End <= s.Start || strings.TrimSpace(s.Text) == "" {
			return nil, errors.New("Segment Groq invalide")
		}
		if s.End-s.Start <= 8 {
			out = append(out, s)
			continue
		}
		words := []ASRWord{}
		for _, w := range response.Words {
			mid := (w.Start + w.End) / 2
			if mid >= s.Start && mid <= s.End && w.End > w.Start && strings.TrimSpace(w.Word) != "" {
				words = append(words, w)
			}
		}
		if len(words) == 0 {
			out = append(out, s)
			continue
		}
		for len(words) > 0 {
			n := 1
			for n < len(words) && n < 14 && words[n-1].End-words[0].Start < 6 {
				n++
			}
			texts := []string{}
			for _, w := range words[:n] {
				texts = append(texts, strings.TrimSpace(w.Word))
			}
			out = append(out, ASRSegment{Start: words[0].Start, End: words[n-1].End, Text: strings.Join(texts, " ")})
			words = words[n:]
		}
	}
	return out, nil
}
func MergeASR(chunks []ASRChunk, duration int64) ([]Segment, error) {
	var merged []ASRSegment
	for _, c := range chunks {
		s, e := PrepareASR(c.Response)
		if e != nil {
			return nil, e
		}
		if c.Start > 0 {
			for i, x := range merged {
				if x.Start >= c.Start {
					merged = merged[:i]
					break
				}
			}
		}
		for _, x := range s {
			if x.End > c.Duration+1 {
				return nil, errors.New("Timestamp Groq hors morceau")
			}
			x.Start += c.Start
			x.End = math.Min(float64(duration)/1000, x.End+c.Start)
			if len(merged) > 0 {
				previous := &merged[len(merged)-1]
				if x.Start < previous.End {
					if c.Start > 0 && previous.Start < c.Start && previous.End > c.Start && x.End > previous.End {
						previous.End = x.End
						if len(x.Text) > len(previous.Text) {
							previous.Text = x.Text
						}
						continue
					}
					x.Start = previous.End
				}
			}
			if x.End > x.Start {
				merged = append(merged, x)
			}
		}
	}
	out := []Segment{}
	for _, s := range merged {
		out = append(out, Segment{ID: id(), Start: int64(math.Round(s.Start * 1000)), End: int64(math.Round(s.End * 1000)), Arabic: s.Text, Version: 1})
	}
	return out, ValidateSegments(out)
}
func RunWorker(ctx context.Context, s *Store, c Config) error {
	if e := os.MkdirAll(c.Storage, 0700); e != nil {
		return e
	}
	var media Media
	var isolated *IsolatedMedia
	switch c.MediaEngine {
	case "isolated-jobs":
		client, e := NewIsolatedClient(c.JobsURL, c.JobsToken, c.JobsCA)
		if e != nil {
			return e
		}
		isolated = &IsolatedMedia{Store: s, Client: client, Storage: c.Storage, Unit: -1}
		media = isolated
	case "", "bubblewrap":
		if c.MediaURL == "" || c.MediaToken == "" {
			return errors.New("MEDIA_URL et MEDIA_TOKEN requis")
		}
		media = &RemoteMedia{URL: c.MediaURL, Token: c.MediaToken, Client: &http.Client{Timeout: 4 * time.Hour}}
	default:
		return errors.New("Moteur média inconnu")
	}
	w := &Worker{Store: s, Config: c, Providers: NewProviders(), Media: media}
	if isolated != nil {
		cleanupCtx, stop := context.WithCancel(ctx)
		done := make(chan struct{})
		go func() {
			defer close(done)
			for cleanupCtx.Err() == nil {
				bounded, cancel := context.WithTimeout(cleanupCtx, 15*time.Second)
				_ = isolated.Reconcile(bounded)
				cancel()
				select {
				case <-cleanupCtx.Done():
					return
				case <-time.After(5 * time.Second):
				}
			}
		}()
		defer func() { stop(); <-done }()
	}
	for ctx.Err() == nil {
		worked, e := w.Once(ctx)
		if e != nil && !errors.Is(e, pgx.ErrNoRows) {
			return errors.New("File de traitement indisponible")
		}
		if !worked {
			select {
			case <-ctx.Done():
			case <-time.After(time.Second):
			}
		}
	}
	return nil
}
func (w *Worker) media(j Job, unit int) Media {
	if m, ok := w.Media.(interface{ ForJob(Job, int) Media }); ok {
		return m.ForJob(j, unit)
	}
	return w.Media
}
func (w *Worker) Once(ctx context.Context) (bool, error) {
	j, e := w.Store.Claim(ctx)
	if e != nil {
		return false, e
	}
	jobCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		tick := time.NewTicker(20 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-jobCtx.Done():
				return
			case <-tick.C:
				if !w.Store.Heartbeat(jobCtx, j) {
					cancel()
					return
				}
			}
		}
	}()
	e = w.process(jobCtx, j)
	cancel()
	<-done
	if e != nil {
		w.Store.Fail(ctx, j, e)
	}
	return true, nil
}
func (w *Worker) provider(ctx context.Context, j Job, provider string) (string, string, error) {
	key, scope, e := w.Store.Key(ctx, w.Config, j.Owner, provider)
	if e != nil {
		return "", "", &ProviderError{Public: e.Error()}
	}
	delay, e := w.Store.Cooldown(ctx, scope)
	if e != nil {
		return "", "", e
	}
	if delay > 0 {
		return "", "", &ProviderError{Public: "Le service est temporairement à sa limite. Votre progression est conservée ; reprise automatique.", Temporary: true, After: delay}
	}
	return key, scope, nil
}
func (w *Worker) providerFailure(ctx context.Context, j Job, scope string, e error) error {
	var p *ProviderError
	if errors.As(e, &p) && p.Temporary {
		delay := p.After
		if delay <= 0 {
			delay = time.Duration(10*(1<<min(j.Attempts, 8)))*time.Second + time.Duration(time.Now().UnixNano()%5000)*time.Millisecond
		}
		if ce := w.Store.SetCooldown(ctx, scope, delay); ce != nil {
			return ce
		}
		p.After = delay
	}
	return e
}
func (w *Worker) process(ctx context.Context, j Job) error {
	p, e := w.Store.Get(ctx, j.Owner, j.ProjectID)
	if e != nil {
		return e
	}
	if p.Generation != j.Generation || (!strings.HasPrefix(j.Kind, "export_") && p.Version != j.SourceVersion) {
		return ErrConflict
	}
	switch j.Kind {
	case "prepare", "download":
		if e = storageRoom(w.Config.Storage, MaxMediaBytes); e != nil {
			return e
		}
		name := id() + ".mp4"
		output := storagePath(w.Config.Storage, name)
		input := ""
		if j.Kind == "prepare" {
			input = storagePath(w.Config.Storage, j.Input.Media)
		}
		info, e := w.media(j, -1).Process(ctx, MediaRequest{Operation: j.Kind, URL: j.Input.URL}, input, output)
		if e != nil {
			return e
		}
		e = w.Store.Finish(ctx, j, func(p *Project) error {
			p.Media = name
			p.Duration = info.Duration
			p.Width = info.Width
			p.Height = info.Height
			p.Stage = "transcribing"
			p.Version++
			return nil
		}, "transcribe")
		if e != nil {
			os.Remove(output)
		}
		return e
	case "transcribe":
		return w.transcribe(ctx, j)
	case "cleanup", "translate":
		return w.text(ctx, j)
	default:
		if !strings.HasPrefix(j.Kind, "export_") {
			return errors.New("Job inconnu")
		}
		parts := strings.Split(j.Kind, "_")
		if len(parts) != 3 {
			return errors.New("Export invalide")
		}
		if e = storageRoom(w.Config.Storage, MaxMediaBytes); e != nil {
			return e
		}
		temp := storagePath(w.Config.Storage, id())
		defer os.Remove(temp)
		_, e = w.media(j, -1).Process(ctx, MediaRequest{Operation: "export", Track: parts[1], Quality: parts[2], Segments: j.Input.Segments}, storagePath(w.Config.Storage, j.Input.Media), temp)
		if e != nil {
			return e
		}
		// The job ID owns this immutable export; lease validation and rename share the project transaction.
		return w.Store.Finish(ctx, j, func(p *Project) error {
			if e := os.Rename(temp, storagePath(w.Config.Storage, j.ID+".mp4")); e != nil {
				return e
			}
			return syncDirectory(w.Config.Storage)
		}, "")
	}
}
func (w *Worker) transcribe(ctx context.Context, j Job) error {
	raw, e := w.Store.Chunks(ctx, j)
	if e != nil {
		return e
	}
	chunks := []ASRChunk{}
	start := 0.
	for _, b := range raw {
		var c ASRChunk
		if e = json.Unmarshal(b, &c); e != nil {
			return e
		}
		chunks = append(chunks, c)
		start = c.Start + math.Max(30, c.Duration-20)
	}
	duration := float64(j.Input.Duration) / 1000
	if len(chunks) > 0 && chunks[len(chunks)-1].Start+chunks[len(chunks)-1].Duration >= duration-.01 {
		segments, e := MergeASR(chunks, j.Input.Duration)
		if e != nil {
			return e
		}
		return w.Store.Finish(ctx, j, func(p *Project) error {
			p.Segments = segments
			p.Stage = "cleaning"
			p.Version++
			p.ArabicVersion++
			return nil
		}, "cleanup")
	}
	key, scope, e := w.provider(ctx, j, "groq")
	if e != nil {
		return e
	}
	temp := storagePath(w.Config.Storage, id())
	defer os.Remove(temp)
	info, e := w.media(j, len(chunks)).Process(ctx, MediaRequest{Operation: "audio", Start: start, Duration: math.Min(600, duration-start)}, storagePath(w.Config.Storage, j.Input.Media), temp)
	if e != nil {
		return e
	}
	response, audit, e := w.Providers.Audio(ctx, key, temp)
	if e != nil {
		return w.providerFailure(ctx, j, scope, e)
	}
	if _, e = PrepareASR(response); e != nil {
		return e
	}
	return w.Store.Chunk(ctx, j, len(chunks), ASRChunk{Start: start, Duration: info.ChunkDuration, Response: response, Raw: audit}, GroqModel, "asr-desktop-v1", min(99, int(100*(start+info.ChunkDuration)/duration)))
}
func (w *Worker) text(ctx context.Context, j Job) error {
	raw, e := w.Store.Chunks(ctx, j)
	if e != nil {
		return e
	}
	chunks, e := resumeTextChunks(j.Input.Segments, raw)
	if e != nil {
		return e
	}
	if len(raw) == len(chunks) {
		segments := append([]Segment{}, j.Input.Segments...)
		n := 0
		for i, b := range raw {
			var result TextResult
			if e = json.Unmarshal(b, &result); e != nil {
				return e
			}
			if e = ValidateText(result, chunks[i]); e != nil {
				return e
			}
			for _, x := range result.Segments {
				if j.Kind == "cleanup" {
					segments[n].Arabic = x.Text
				} else {
					segments[n].French = x.Text
				}
				segments[n].Version++
				n++
			}
		}
		return w.Store.Finish(ctx, j, func(p *Project) error {
			p.Segments = segments
			p.Version++
			if j.Kind == "cleanup" {
				p.ArabicVersion++
				p.Stage = "arabic"
			} else {
				p.TranslationSource = p.ArabicVersion
				p.Stage = "review"
				p.ConfirmedReview = 0
			}
			return nil
		}, "")
	}
	if len(raw) > len(chunks) {
		return errors.New("Morceaux incohérents")
	}
	key, scope, e := w.provider(ctx, j, "gemini")
	if e != nil {
		return e
	}
	i := len(raw)
	contextSegments := []Segment{}
	if i > 0 {
		previous := chunks[i-1]
		contextSegments = append(contextSegments, previous[max(0, len(previous)-2):]...)
	}
	if i+1 < len(chunks) {
		next := chunks[i+1]
		contextSegments = append(contextSegments, next[:min(2, len(next))]...)
	}
	result, e := w.Providers.Text(ctx, key, j.Kind, chunks[i], contextSegments)
	if e != nil {
		return w.providerFailure(ctx, j, scope, e)
	}
	if e = ValidateText(result, chunks[i]); e != nil {
		return e
	}
	return w.Store.Chunk(ctx, j, i, result, GeminiModel, j.Kind+"-v1", (i+1)*99/len(chunks))
}

// Saved results define immutable completed boundaries, including those written by
// an older chunk policy. Repartition only the unprocessed suffix after an upgrade.
func resumeTextChunks(segments []Segment, saved []json.RawMessage) ([][]Segment, error) {
	chunks := [][]Segment{}
	offset := 0
	for _, raw := range saved {
		var result TextResult
		if err := json.Unmarshal(raw, &result); err != nil {
			return nil, err
		}
		n := len(result.Segments)
		if n == 0 || n > len(segments)-offset {
			return nil, errors.New("Morceaux incohérents")
		}
		source := segments[offset : offset+n]
		if err := ValidateText(result, source); err != nil {
			return nil, err
		}
		chunks = append(chunks, source)
		offset += n
	}
	return append(chunks, TextChunks(segments[offset:])...), nil
}
