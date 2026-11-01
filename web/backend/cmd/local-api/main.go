// local-api is a JSON bridge to the actual web providers, not a second LLM engine.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"tarjama/web/internal/references"
	"tarjama/web/internal/studio"
)

type request struct {
	Kind          string            `json:"kind"`
	Segments      []studio.Segment  `json:"segments"`
	Chunk         int               `json:"chunk"`
	Corpus        string            `json:"corpus"`
	Audio         string            `json:"audio"`
	Start         float64           `json:"start"`
	Duration      float64           `json:"duration"`
	TotalDuration int64             `json:"total_duration"`
	ASRChunks     []studio.ASRChunk `json:"asr_chunks"`
	TextResult    studio.TextResult `json:"text_result"`
	Width         int               `json:"width"`
	Height        int               `json:"height"`
}

func key(name string) (string, error) {
	v := os.Getenv(name)
	if path := os.Getenv(name + "_FILE"); path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return "", errors.New("Fichier de clé inaccessible : " + name + "_FILE")
		}
		v = string(b)
	}
	if strings.TrimSpace(v) == "" {
		return "", errors.New("Clé absente : " + name)
	}
	return strings.TrimSpace(v), nil
}

func execute(ctx context.Context, r request, p *studio.HTTPProviders) (any, error) {
	if r.Kind == "audio" {
		k, err := key("GROQ_API_KEY")
		if err != nil {
			return nil, err
		}
		response, raw, err := p.Audio(ctx, k, r.Audio)
		return studio.ASRChunk{Start: r.Start, Duration: r.Duration, Response: response, Raw: raw}, err
	}
	if r.Kind == "merge-asr" {
		return studio.MergeASR(r.ASRChunks, r.TotalDuration)
	}
	if err := studio.ValidateSegments(r.Segments); err != nil {
		return nil, err
	}
	if r.Kind == "subtitles" {
		if r.Width < 2 || r.Height < 2 || r.Width > 8192 || r.Height > 8192 {
			return nil, errors.New("Dimensions invalides")
		}
		return map[string]string{"ass": studio.ASS(r.Segments, r.Width, r.Height, "fr"), "srt": studio.SRT(r.Segments, "fr")}, nil
	}
	chunks := studio.TextChunks(r.Segments)
	if r.Kind == "plan" {
		return map[string]any{"chunks": chunks, "model": studio.TextModel, "reasoning": studio.TextReasoningEffort, "max_output_tokens": studio.TextMaxOutputTokens, "groq_model": studio.GroqModel}, nil
	}
	if r.Kind == "validate-text" {
		return nil, studio.ValidateText(r.TextResult, r.Segments)
	}
	if r.Kind != "cleanup" && r.Kind != "translate" {
		return nil, errors.New("Opération inconnue")
	}
	if r.Chunk < 0 || r.Chunk >= len(chunks) {
		return nil, errors.New("Morceau invalide")
	}
	corpus, err := references.Load(r.Corpus)
	if err != nil {
		return nil, errors.New("Corpus de références indisponible : lancer make references-import")
	}
	p.References = corpus
	k, err := key("OPENROUTER_API_KEY")
	if err != nil {
		return nil, err
	}
	return p.Text(ctx, k, r.Kind, chunks[r.Chunk], studio.TextChunkContext(chunks, r.Chunk))
}

func main() {
	var r request
	d := json.NewDecoder(io.LimitReader(os.Stdin, 64*1024*1024))
	d.DisallowUnknownFields()
	if err := d.Decode(&r); err != nil {
		fmt.Fprintln(os.Stderr, "Requête JSON invalide")
		os.Exit(1)
	}
	result, err := execute(context.Background(), r, studio.NewProviders())
	out := map[string]any{"result": result}
	if err != nil {
		out["error"] = err.Error()
	}
	if json.NewEncoder(os.Stdout).Encode(out) != nil {
		os.Exit(1)
	}
	if err != nil {
		os.Exit(1)
	}
}
