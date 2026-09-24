package studio

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"strings"
	"tarjama/web/internal/research"
	"time"
	"unicode"
)

//go:embed prompts/*.txt
var prompts embed.FS

const TextModel = "deepseek/deepseek-v4.1-flash"
const TextMaxOutputTokens = 32768
const GroqModel = "whisper-large-v3"

type ProviderError struct {
	Public    string
	Temporary bool
	After     time.Duration
}

func (e *ProviderError) Error() string { return e.Public }

type TextResult struct {
	Segments []struct {
		ID   string `json:"id"`
		Text string `json:"text"`
	} `json:"segments"`
	// Provider provenance is separate from subtitle text, never supplied by the model.
	Grounding json.RawMessage `json:"grounding,omitempty"`
}
type ASRSegment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}
type ASRWord struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Word  string  `json:"word"`
}
type ASRResponse struct {
	Segments []ASRSegment `json:"segments"`
	Words    []ASRWord    `json:"words"`
}
type Providers interface {
	Text(context.Context, string, string, []Segment, []Segment) (TextResult, error)
	Audio(context.Context, string, string) (ASRResponse, json.RawMessage, error)
}
type HTTPProviders struct {
	Client           *http.Client
	TextURL, GroqURL string
	Research         *research.Parallel
}

func NewProviders() *HTTPProviders {
	return &HTTPProviders{Research: research.NewParallel(secret("PARALLEL_API_KEY")), Client: &http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, TextURL: "https://openrouter.ai/api/v1/chat/completions", GroqURL: "https://api.groq.com/openai/v1/audio/transcriptions"}
}
func providerError(r *http.Response) *ProviderError {
	e := &ProviderError{Public: "Le fournisseur a refusé la requête. Vérifiez la configuration du service."}
	switch r.StatusCode {
	case 401, 403:
		e.Public = "Clé refusée : remplacez votre clé personnelle ou signalez la clé partagée à l’administrateur."
	case 404:
		e.Public = "Le modèle demandé n’est pas accessible à ce compte. Contactez l’administrateur."
	case 429, 408, 500, 502, 503, 504:
		e.Temporary = true
		e.Public = "Le service est temporairement limité ou indisponible. Votre progression est conservée et reprendra automatiquement. Vous pouvez attendre ou ajouter une clé personnelle."
	}
	if seconds, e2 := strconv.Atoi(r.Header.Get("Retry-After")); e2 == nil && seconds > 0 {
		e.After = time.Duration(seconds) * time.Second
	} else if date, e2 := http.ParseTime(r.Header.Get("Retry-After")); e2 == nil {
		e.After = max(0, time.Until(date))
	}
	return e
}
func readResponse(r *http.Response) ([]byte, error) {
	defer r.Body.Close()
	if r.StatusCode < 200 || r.StatusCode >= 300 {
		return nil, providerError(r)
	}
	b, e := io.ReadAll(io.LimitReader(r.Body, 4*1024*1024+1))
	if len(b) > 4*1024*1024 {
		return nil, errors.New("Réponse fournisseur trop grande")
	}
	return b, e
}
func ValidateText(result TextResult, s []Segment) error {
	if len(result.Segments) != len(s) {
		return errors.New("Réponse IA incomplète")
	}
	for i, x := range result.Segments {
		if x.ID != s[i].ID || strings.TrimSpace(x.Text) == "" || len(x.Text) > 16000 {
			return errors.New("Réponse IA mal alignée")
		}
		for _, r := range x.Text {
			if unicode.Is(unicode.Co, r) || r == '\x00' {
				return errors.New("Marqueur technique interdit")
			}
		}
		if strings.Contains(x.Text, "<!--") {
			return errors.New("Commentaire technique interdit")
		}
	}
	return nil
}
func (p *HTTPProviders) Text(ctx context.Context, key, kind string, s, contextSegments []Segment) (TextResult, error) {
	return p.textWithResearch(ctx, key, kind, s, contextSegments, p.TextURL, TextModel)
}

// Standalone evaluations use the same tools and validation as the application.
func (p *HTTPProviders) EvaluateOpenRouter(ctx context.Context, key, model string, s []Segment) (TextResult, error) {
	return p.textWithResearch(ctx, key, "translate", s, nil, "https://openrouter.ai/api/v1/chat/completions", model)
}
func (p *HTTPProviders) textWithResearch(ctx context.Context, key, kind string, s, contextSegments []Segment, endpoint, model string) (TextResult, error) {
	var result TextResult
	if p.Research == nil || p.Research.Key == "" {
		return result, &ProviderError{Public: "La recherche Parallel n’est pas configurée. Votre progression est conservée ; l’administrateur doit enregistrer cet accès.", Temporary: true, After: 10 * time.Minute}
	}
	prompt, err := prompts.ReadFile("prompts/" + kind + ".txt")
	if err != nil {
		return result, errors.New("Type de traitement inconnu")
	}
	type item struct {
		ID   string `json:"id"`
		Text string `json:"text"`
	}
	target, contextText := []item{}, []item{}
	for _, x := range s {
		target = append(target, item{x.ID, x.Arabic})
	}
	for _, x := range contextSegments {
		contextText = append(contextText, item{x.ID, x.Arabic})
	}
	input := map[string]any{"segments": target, "context_only": contextText}
	schema := map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"segments": map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"id": map[string]string{"type": "string"}, "text": map[string]string{"type": "string"}}, "required": []string{"id", "text"}}}}, "required": []string{"segments"}}
	runner := research.Runner{Parallel: p.Research, Client: p.Client, Endpoint: endpoint, Model: model}
	output, err := runner.Run(ctx, key, string(prompt), input, schema)
	if err != nil {
		var modelError *research.ModelHTTPError
		var connectionError *research.ConnectionError
		if errors.As(err, &connectionError) {
			return result, &ProviderError{Public: connectionError.Error() + " ; reprise automatique.", Temporary: true}
		}
		if errors.As(err, &modelError) {
			failure := providerError(&http.Response{StatusCode: modelError.Status, Header: http.Header{"Retry-After": []string{modelError.RetryAfter}}})
			return result, failure
		}
		var webError *research.HTTPError
		if errors.As(err, &webError) {
			return result, &ProviderError{Public: "La recherche Parallel est indisponible. La progression est conservée.", Temporary: webError.Status == 429 || webError.Status >= 500, After: time.Minute}
		}
		return result, err
	}
	d := json.NewDecoder(strings.NewReader(output.Text))
	d.DisallowUnknownFields()
	// The model owns subtitles only. Provenance comes from executed tools.
	wire := struct {
		Segments json.RawMessage `json:"segments"`
	}{}
	if d.Decode(&wire) != nil || d.Decode(new(any)) != io.EOF {
		return result, errors.New("Réponse IA invalide")
	}
	d = json.NewDecoder(bytes.NewReader(wire.Segments))
	d.DisallowUnknownFields()
	if d.Decode(&result.Segments) != nil {
		return result, errors.New("Réponse IA invalide")
	}
	result.Grounding, _ = json.Marshal(output.Audit)
	return result, ValidateText(result, s)
}
func (p *HTTPProviders) Audio(ctx context.Context, key, path string) (ASRResponse, json.RawMessage, error) {
	var out ASRResponse
	file, e := os.Open(path)
	if e != nil {
		return out, nil, e
	}
	defer file.Close()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, e := writer.CreateFormFile("file", "audio.flac")
	if e != nil {
		return out, nil, e
	}
	n, e := io.Copy(part, io.LimitReader(file, 23*1024*1024+1))
	if e != nil || n > 23*1024*1024 {
		return out, nil, errors.New("Morceau audio trop grand")
	}
	for k, v := range map[string]string{"model": GroqModel, "language": "ar", "temperature": "0", "response_format": "verbose_json"} {
		writer.WriteField(k, v)
	}
	writer.WriteField("timestamp_granularities[]", "word")
	writer.WriteField("timestamp_granularities[]", "segment")
	writer.Close()
	req, e := http.NewRequestWithContext(ctx, "POST", p.GroqURL, &body)
	if e != nil {
		return out, nil, e
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+key)
	r, e := p.Client.Do(req)
	if e != nil {
		return out, nil, &ProviderError{Public: "Connexion Groq interrompue ; reprise automatique.", Temporary: true}
	}
	raw, e := readResponse(r)
	if e != nil {
		return out, nil, e
	}
	e = json.Unmarshal(raw, &out)
	if e != nil || out.Segments == nil {
		return out, raw, fmt.Errorf("Réponse Groq sans segments")
	}
	return out, raw, nil
}
