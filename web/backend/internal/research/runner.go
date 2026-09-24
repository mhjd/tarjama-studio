package research

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Audit contains provider metadata, never provenance asserted in subtitle JSON.
// Engine records the requested engine; usage/annotations record returned evidence.
type Audit struct {
	Engine      string            `json:"engine"`
	ModelUsage  []json.RawMessage `json:"model_usage"`
	Annotations json.RawMessage   `json:"annotations,omitempty"`
	RequestID   string            `json:"request_id,omitempty"`
	ModelCalls  int               `json:"model_calls"` // HTTP requests, not hidden inference rounds
}
type Output struct {
	Text  string
	Audit Audit
}
type Runner struct {
	Client                        *http.Client
	Endpoint, Model               string
	MaxOutputTokens, MaxToolCalls int
}
type ModelHTTPError struct {
	Status     int
	RetryAfter string
}

func (e *ModelHTTPError) Error() string { return "Requête modèle refusée" }

type ConnectionError struct{ Service string }

func (e *ConnectionError) Error() string { return "Connexion " + e.Service + " interrompue" }

var ErrTruncated = errors.New("Réponse IA tronquée")

// OpenRouter executes both tools with Parallel, billed to the same OpenRouter key.
// Explicit engines prevent the auto/native selection and its Exa fallback.
func ServerTools() []any {
	return []any{
		map[string]any{"type": "openrouter:web_search", "parameters": map[string]any{"engine": "parallel", "mode": "advanced", "max_results": 20, "max_uses": 6, "max_total_results": 120, "search_context_size": "medium"}},
		map[string]any{"type": "openrouter:web_fetch", "parameters": map[string]any{"engine": "parallel", "max_uses": 10, "max_content_tokens": 12000}},
	}
}
func (r *Runner) Run(ctx context.Context, key, prompt string, input, schema any) (Output, error) {
	out := Output{Audit: Audit{Engine: "parallel", ModelUsage: []json.RawMessage{}}}
	if strings.Contains(strings.ToLower(r.Model), "gemini") {
		return out, errors.New("Gemini a été retiré des modèles autorisés")
	}
	if strings.TrimSpace(key) == "" {
		return out, errors.New("Accès OpenRouter non configuré")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	user, e := json.Marshal(input)
	if e != nil {
		return out, errors.New("Entrée modèle invalide")
	}
	maxTokens := r.MaxOutputTokens
	if maxTokens <= 0 || maxTokens > 32768 {
		maxTokens = 32768
	}
	maxTools := r.MaxToolCalls
	if maxTools <= 0 || maxTools > 16 {
		maxTools = 16
	}
	// Server-tool continuations may not preserve the provider's schema constraint.
	// Repeat the application-owned contract in instructions and still validate locally.
	contract, e := json.Marshal(schema)
	if e != nil {
		return out, errors.New("Schéma modèle invalide")
	}
	prompt += "\nRetourne uniquement du JSON brut, sans balises Markdown ni texte autour, conforme à ce schéma : " + string(contract)
	payload := map[string]any{"model": r.Model, "messages": []any{
		map[string]string{"role": "system", "content": prompt}, map[string]string{"role": "user", "content": string(user)},
	}, "tools": ServerTools(), "tool_choice": "auto", "max_tool_calls": maxTools, "max_tokens": maxTokens,
		"response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "translation", "strict": true, "schema": schema}},
		"provider":        map[string]any{"require_parameters": true}}
	b, e := json.Marshal(payload)
	if e != nil {
		return out, errors.New("Schéma modèle invalide")
	}
	req, e := http.NewRequestWithContext(ctx, "POST", r.Endpoint, bytes.NewReader(b))
	if e != nil {
		return out, errors.New("Configuration modèle invalide")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	out.Audit.ModelCalls = 1
	response, e := r.Client.Do(req)
	if e != nil {
		return out, &ConnectionError{Service: "modèle"}
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return out, &ModelHTTPError{response.StatusCode, response.Header.Get("Retry-After")}
	}
	raw, e := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
	if e != nil {
		return out, &ConnectionError{Service: "modèle"}
	}
	if len(raw) > 4*1024*1024 {
		return out, errors.New("Réponse fournisseur trop grande")
	}
	// OpenRouter can report a provider error after sending HTTP 200 headers.
	// Inspect only the numeric status; never expose its message or metadata.
	var failure struct {
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(raw, &failure) != nil {
		return out, errors.New("Réponse OpenRouter invalide")
	}
	if len(failure.Error) > 0 && string(failure.Error) != "null" {
		var detail struct {
			Code json.Number `json:"code"`
		}
		if json.Unmarshal(failure.Error, &detail) == nil {
			if status, err := strconv.Atoi(string(detail.Code)); err == nil && status >= 400 && status <= 599 {
				return out, &ModelHTTPError{status, response.Header.Get("Retry-After")}
			}
		}
		return out, errors.New("Erreur OpenRouter sans statut")
	}
	var envelope struct {
		ID      string `json:"id"`
		Choices []struct {
			Finish  string `json:"finish_reason"`
			Message struct {
				Content     string            `json:"content"`
				Calls       []json.RawMessage `json:"tool_calls"`
				Annotations json.RawMessage   `json:"annotations"`
			} `json:"message"`
		} `json:"choices"`
		Usage json.RawMessage `json:"usage"`
	}
	if json.Unmarshal(raw, &envelope) != nil || len(envelope.Choices) != 1 {
		return out, errors.New("Réponse OpenRouter invalide")
	}
	out.Audit.RequestID = envelope.ID
	if len(envelope.Usage) > 0 {
		out.Audit.ModelUsage = append(out.Audit.ModelUsage, envelope.Usage)
	}
	candidate := envelope.Choices[0]
	out.Audit.Annotations = candidate.Message.Annotations
	if candidate.Finish == "length" {
		return out, ErrTruncated
	}
	if candidate.Finish != "stop" {
		return out, errors.New("Réponse IA tronquée ou refusée")
	}
	if len(candidate.Message.Calls) > 0 {
		return out, errors.New("Outil client inattendu : exécution réservée à OpenRouter")
	}
	if strings.TrimSpace(candidate.Message.Content) == "" {
		return out, errors.New("Réponse modèle vide")
	}
	out.Text = candidate.Message.Content
	return out, nil
}
