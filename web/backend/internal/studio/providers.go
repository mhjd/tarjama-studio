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
	"time"
	"unicode"
)

//go:embed prompts/*.txt
var prompts embed.FS

const GeminiModel = "gemini-3.8-flash"
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
	Client             *http.Client
	GeminiURL, GroqURL string
}

func NewProviders() *HTTPProviders {
	return &HTTPProviders{Client: &http.Client{Timeout: 100 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, GeminiURL: "https://generativelanguage.googleapis.com/v1beta/models/" + GeminiModel + ":generateContent", GroqURL: "https://api.groq.com/openai/v1/audio/transcriptions"}
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
	// Google distinguishes daily quota from transient capacity in structured
	// details. Never display its raw error message, which may contain identifiers.
	if r.StatusCode == http.StatusTooManyRequests && r.Body != nil {
		var payload struct {
			Error struct {
				Details []struct {
					Violations []struct {
						ID string `json:"quotaId"`
					} `json:"violations"`
				} `json:"details"`
			} `json:"error"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 16384)).Decode(&payload) == nil {
			for _, detail := range payload.Error.Details {
				for _, violation := range detail.Violations {
					if strings.HasPrefix(violation.ID, "GenerateRequestsPerDayPerProjectPerModel") {
						e.Public = "Le quota quotidien de Gemini est atteint. Votre progression est conservée. La reprise sera automatique lorsque du quota sera disponible. Vous pouvez attendre ou ajouter une clé personnelle disposant de quota."
					}
				}
			}
		}
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
	prompt, _ := prompts.ReadFile("prompts/" + kind + ".txt")
	type item struct {
		ID   string `json:"id"`
		Text string `json:"text"`
	}
	target := []item{}
	contextText := []item{}
	for _, x := range s {
		target = append(target, item{x.ID, x.Arabic})
	}
	for _, x := range contextSegments {
		contextText = append(contextText, item{x.ID, x.Arabic})
	}
	input, _ := json.Marshal(map[string]any{"segments": target, "context_only": contextText})
	schema := map[string]any{"type": "object", "properties": map[string]any{"segments": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]string{"type": "string"}, "text": map[string]string{"type": "string"}}, "required": []string{"id", "text"}}}}, "required": []string{"segments"}}
	body, _ := json.Marshal(map[string]any{"systemInstruction": map[string]any{"parts": []any{map[string]string{"text": string(prompt)}}}, "contents": []any{map[string]any{"role": "user", "parts": []any{map[string]string{"text": string(input)}}}}, "generationConfig": map[string]any{"responseMimeType": "application/json", "responseJsonSchema": schema, "maxOutputTokens": 16384}})
	req, e := http.NewRequestWithContext(ctx, "POST", p.GeminiURL, bytes.NewReader(body))
	if e != nil {
		return TextResult{}, e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", key)
	r, e := p.Client.Do(req)
	if e != nil {
		return TextResult{}, &ProviderError{Public: "Connexion au fournisseur interrompue ; reprise automatique.", Temporary: true}
	}
	raw, e := readResponse(r)
	if e != nil {
		return TextResult{}, e
	}
	var envelope struct {
		Candidates []struct {
			FinishReason string `json:"finishReason"`
			Content      struct {
				Parts []struct {
					Text    string `json:"text"`
					Thought bool   `json:"thought"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if json.Unmarshal(raw, &envelope) != nil || len(envelope.Candidates) != 1 || envelope.Candidates[0].FinishReason != "STOP" {
		return TextResult{}, errors.New("Réponse IA tronquée ou refusée")
	}
	var content string
	for _, part := range envelope.Candidates[0].Content.Parts {
		if !part.Thought {
			content += part.Text
		}
	}
	var result TextResult
	d := json.NewDecoder(strings.NewReader(content))
	d.DisallowUnknownFields()
	if e = d.Decode(&result); e != nil {
		return result, errors.New("Réponse IA invalide")
	}
	if d.Decode(new(any)) != io.EOF {
		return result, errors.New("Réponse IA invalide")
	}
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
