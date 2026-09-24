package research

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

type Call struct {
	ID   string
	Name string
	Args json.RawMessage
}
type Trace struct {
	Tool      string          `json:"tool"`
	Arguments json.RawMessage `json:"arguments"`
	Result    Result          `json:"result"`
	ElapsedMS int64           `json:"elapsed_ms"`
}
type Audit struct {
	Engine     string            `json:"engine"`
	Calls      []Trace           `json:"calls"`
	ModelUsage []json.RawMessage `json:"model_usage"`
	ModelCalls int               `json:"model_calls"`
}
type Output struct {
	Text  string
	Audit Audit
}
type Runner struct {
	Parallel                   *Parallel
	Client                     *http.Client
	Endpoint, Model            string
	MaxOutputTokens, MaxRounds int
}
type ModelHTTPError struct {
	Status     int
	RetryAfter string
}

func (e *ModelHTTPError) Error() string { return "Requête modèle refusée" }

type ConnectionError struct{ Service string }

func (e *ConnectionError) Error() string { return "Connexion " + e.Service + " interrompue" }

var ErrTruncated = errors.New("Réponse IA tronquée")

// All selected models use application-owned tools via OpenRouter function calling.
// No native search/plugin, direct page fetch, or alternate model fallback is added.
func (r *Runner) Run(ctx context.Context, key, prompt string, input, schema any) (Output, error) {
	out := Output{Audit: Audit{Engine: "parallel", Calls: []Trace{}, ModelUsage: []json.RawMessage{}}}
	if strings.Contains(strings.ToLower(r.Model), "gemini") {
		return out, errors.New("Gemini a été retiré des modèles autorisés")
	}
	if r.Parallel == nil || r.Parallel.Key == "" {
		return out, errors.New("Outils Parallel absents")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	user, _ := json.Marshal(input)
	var messages []json.RawMessage
	add := func(v any) { b, _ := json.Marshal(v); messages = append(messages, b) }
	add(map[string]string{"role": "system", "content": prompt})
	add(map[string]string{"role": "user", "content": string(user)})
	session := ""
	searches, fetches := 0, 0
	rounds := r.MaxRounds
	if rounds <= 0 || rounds > 12 {
		rounds = 12
	}
	for round := 0; round < rounds; round++ {
		if ctx.Err() != nil {
			return out, errors.New("Délai de recherche dépassé ou traitement annulé")
		}
		text, calls, message, usage, e := r.step(ctx, key, messages, schema)
		out.Audit.ModelCalls++
		if len(usage) > 0 {
			out.Audit.ModelUsage = append(out.Audit.ModelUsage, usage)
		}
		if e != nil {
			return out, e
		}
		if len(calls) == 0 {
			if text == "" {
				return out, errors.New("Réponse modèle vide")
			}
			out.Text = text
			return out, nil
		}
		// Retain complete opaque reasoning metadata when returning a tool result.
		messages = append(messages, message)
		for _, call := range calls {
			switch call.Name {
			case "web_search":
				searches++
			case "web_fetch":
				fetches++
			default:
				return out, errors.New("Outil modèle non autorisé")
			}
			if searches > 6 || fetches > 10 || len(out.Audit.Calls) >= 16 {
				return out, errors.New("Budget de recherche atteint")
			}
			start := time.Now()
			result, e := r.Parallel.Execute(ctx, call.Name, call.Args, session)
			if e != nil {
				return out, e
			}
			session = result.Session
			out.Audit.Calls = append(out.Audit.Calls, Trace{call.Name, call.Args, result, time.Since(start).Milliseconds()})
			encoded, _ := json.Marshal(result)
			add(map[string]string{"role": "tool", "tool_call_id": call.ID, "content": string(encoded)})
		}
	}
	return out, errors.New("Nombre maximal de tours de recherche atteint")
}
func (r *Runner) step(ctx context.Context, key string, messages []json.RawMessage, schema any) (text string, calls []Call, message, usage json.RawMessage, err error) {
	maxTokens := r.MaxOutputTokens
	if maxTokens <= 0 || maxTokens > 32768 {
		maxTokens = 32768
	}
	var defs []any
	for _, d := range Definitions() {
		defs = append(defs, map[string]any{"type": "function", "function": d})
	}
	payload := map[string]any{"model": r.Model, "messages": messages, "tools": defs, "tool_choice": "auto", "max_tokens": maxTokens,
		"response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "translation", "strict": true, "schema": schema}},
		"provider":        map[string]any{"require_parameters": true}}
	b, _ := json.Marshal(payload)
	req, e := http.NewRequestWithContext(ctx, "POST", r.Endpoint, bytes.NewReader(b))
	if e != nil {
		err = errors.New("Configuration modèle invalide")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	response, e := r.Client.Do(req)
	if e != nil {
		err = &ConnectionError{Service: "modèle"}
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		err = &ModelHTTPError{response.StatusCode, response.Header.Get("Retry-After")}
		return
	}
	raw, e := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
	if e != nil || len(raw) > 4*1024*1024 {
		err = errors.New("Réponse modèle illisible ou trop grande")
		return
	}
	var envelope struct {
		Choices []struct {
			Finish  string          `json:"finish_reason"`
			Message json.RawMessage `json:"message"`
		} `json:"choices"`
		Usage json.RawMessage `json:"usage"`
	}
	if json.Unmarshal(raw, &envelope) != nil || len(envelope.Choices) != 1 {
		err = errors.New("Réponse OpenRouter invalide")
		return
	}
	usage = envelope.Usage
	candidate := envelope.Choices[0]
	if candidate.Finish == "length" {
		err = ErrTruncated
		return
	}
	if candidate.Finish != "stop" && candidate.Finish != "tool_calls" {
		err = errors.New("Réponse IA tronquée ou refusée")
		return
	}
	var msg struct {
		Content string `json:"content"`
		Calls   []struct {
			ID       string `json:"id"`
			Type     string `json:"type"`
			Function struct {
				Name string `json:"name"`
				Args string `json:"arguments"`
			} `json:"function"`
		} `json:"tool_calls"`
	}
	if json.Unmarshal(candidate.Message, &msg) != nil {
		err = errors.New("Contenu OpenRouter invalide")
		return
	}
	message = candidate.Message
	text = msg.Content
	seen := map[string]bool{}
	for _, c := range msg.Calls {
		if c.ID == "" || len(c.ID) > 200 || seen[c.ID] || c.Type != "function" {
			err = errors.New("Appel d'outil invalide")
			return
		}
		seen[c.ID] = true
		calls = append(calls, Call{c.ID, c.Function.Name, json.RawMessage(c.Function.Args)})
	}
	if candidate.Finish == "tool_calls" && len(calls) == 0 {
		err = errors.New("Appel d'outil absent")
	}
	return
}
