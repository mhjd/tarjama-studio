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
	LocalCalls      int               `json:"local_calls"`
	Local           []LocalEvidence   `json:"local_references,omitempty"`
	Engine          string            `json:"engine"`
	ModelUsage      []json.RawMessage `json:"model_usage"`
	Annotations     json.RawMessage   `json:"annotations,omitempty"`
	RequestIDs      []string          `json:"request_ids,omitempty"`
	WebCalls        int               `json:"web_calls"`
	WebUsageUnknown bool              `json:"web_usage_unknown,omitempty"`
	RequestID       string            `json:"request_id,omitempty"`
	ModelCalls      int               `json:"model_calls"` // HTTP requests, not hidden inference rounds
}
type LocalTools interface {
	Tools() []any
	Call(string, json.RawMessage) (any, error)
}
type LocalEvidence struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
	Result    json.RawMessage `json:"result"`
}
type Output struct {
	Text  string
	Audit Audit
}
type Runner struct {
	LocalTools                    LocalTools
	Client                        *http.Client
	Endpoint, Model               string
	ReasoningEffort               string
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
	}, "tools": ServerTools(), "tool_choice": "auto", "max_tool_calls": min(4, maxTools), "max_tokens": maxTokens,
		"response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "translation", "strict": true, "schema": schema}},
		"provider":        map[string]any{"require_parameters": true}}
	if r.ReasoningEffort != "" {
		payload["reasoning"] = map[string]string{"effort": r.ReasoningEffort}
	}
	if r.LocalTools != nil {
		payload["tools"] = append(ServerTools(), r.LocalTools.Tools()...)
	}
	localCalls, serverCalls := 0, 0
	for round := 0; round < 6; round++ {
		deadline, _ := ctx.Deadline()
		finalize := round == 5 || localCalls >= 8 || (round > 0 && time.Until(deadline) < 90*time.Second)
		if err := ctx.Err(); err != nil {
			return out, &ConnectionError{Service: "modèle"}
		}
		if round > 0 {
			remaining := maxTools - serverCalls
			available := []any{}
			if remaining > 0 {
				available = append(available, ServerTools()...)
				payload["max_tool_calls"] = min(4, remaining)
			} else {
				delete(payload, "max_tool_calls")
			}
			if localCalls < 8 && r.LocalTools != nil {
				available = append(available, r.LocalTools.Tools()...)
			}
			payload["tools"] = available
		}
		if finalize {
			// Keep the schemas and tool results in the conversation, but force a
			// final answer. No new research budget is granted on this turn.
			payload["tool_choice"] = "none"
			payload["tools"] = []any{}
			if r.LocalTools != nil {
				payload["tools"] = r.LocalTools.Tools()
			}
			delete(payload, "max_tool_calls")
		}
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
		// Reserve a bounded slice before the HTTP call. Incomplete usage may
		// not refund it; it cannot renew the full allowance on continuation.
		allowance, _ := payload["max_tool_calls"].(int)
		serverCalls += allowance
		out.Audit.ModelCalls++
		response, e := r.Client.Do(req)
		if e != nil {
			return out, &ConnectionError{Service: "modèle"}
		}

		if response.StatusCode != 200 {
			response.Body.Close()
			return out, &ModelHTTPError{response.StatusCode, response.Header.Get("Retry-After")}
		}
		raw, e := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
		response.Body.Close()
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
			ID    string          `json:"id"`
			Usage json.RawMessage `json:"usage"`
		}
		if json.Unmarshal(raw, &failure) != nil {
			return out, errors.New("Réponse OpenRouter invalide")
		}
		out.Audit.RequestID = failure.ID
		if failure.ID != "" {
			out.Audit.RequestIDs = append(out.Audit.RequestIDs, failure.ID)
		}
		if len(failure.Usage) > 0 && string(failure.Usage) != "null" {
			out.Audit.ModelUsage = append(out.Audit.ModelUsage, failure.Usage)
		}
		if allowance > 0 {
			used, complete := serverToolCalls(failure.Usage)
			out.Audit.WebCalls += used
			if complete && used <= allowance {
				serverCalls -= allowance - used
			} else {
				if used > allowance {
					serverCalls += used - allowance
				}
				out.Audit.WebUsageUnknown = true
			}
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
			Choices []struct {
				Finish  string `json:"finish_reason"`
				Message struct {
					Content     string            `json:"content"`
					Calls       []json.RawMessage `json:"tool_calls"`
					Annotations json.RawMessage   `json:"annotations"`
				} `json:"message"`
			} `json:"choices"`
		}
		if json.Unmarshal(raw, &envelope) != nil || len(envelope.Choices) != 1 {
			return out, errors.New("Réponse OpenRouter invalide")
		}

		candidate := envelope.Choices[0]
		out.Audit.Annotations = candidate.Message.Annotations
		if candidate.Finish == "length" {
			return out, ErrTruncated
		}
		if len(candidate.Message.Calls) > 0 {
			if r.LocalTools == nil || candidate.Finish != "tool_calls" || finalize || len(candidate.Message.Calls) > 64 {
				return out, &ProtocolError{Code: "tool_protocol"}
			}
			var original struct {
				Choices []struct {
					Message json.RawMessage `json:"message"`
				} `json:"choices"`
			}
			if json.Unmarshal(raw, &original) != nil {
				return out, &ProtocolError{Code: "tool_message"}
			}
			messages := payload["messages"].([]any)
			messages = append(messages, original.Choices[0].Message)
			seen := map[string]bool{}
			for _, callRaw := range candidate.Message.Calls {
				var call struct {
					ID       string `json:"id"`
					Type     string `json:"type"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				}
				if json.Unmarshal(callRaw, &call) != nil || call.ID == "" || seen[call.ID] || call.Type != "function" {
					return out, &ProtocolError{Code: "tool_call"}
				}
				seen[call.ID] = true
				switch call.Function.Name {
				case "quran_fr":
				default:
					return out, &ProtocolError{Code: "tool_forbidden"}
				}
				var value any
				var err error
				if localCalls < 8 {
					value, err = r.LocalTools.Call(call.Function.Name, json.RawMessage(call.Function.Arguments))
					localCalls++
					out.Audit.LocalCalls++
				} else {
					value = map[string]string{"status": "budget_exhausted", "message": "Recherche non effectuée. Termine avec les éléments déjà obtenus, sans inventer de vérification ni de référence."}
				}
				if err != nil {
					// A validation error is data the model can correct, within the
					// same fixed call/round budget. No provider request is retried.
					value = map[string]string{"status": "invalid_query", "message": "Utilise une référence exacte OU un fragment arabe d'au moins trois mots. quran_fr : surah/verse >= 1, end_verse facultatif, plage <= 10. Aucun champ supplémentaire."}
				}
				encoded, err := json.Marshal(value)
				if err != nil || len(encoded) > 512*1024 {
					return out, &ProtocolError{Code: "tool_result"}
				}
				arguments := json.RawMessage(call.Function.Arguments)
				if !json.Valid(arguments) {
					// Keep malformed arguments as a JSON string so audit serialization
					// cannot erase the evidence or fail after the model corrects itself.
					arguments, _ = json.Marshal(call.Function.Arguments)
				}
				out.Audit.Local = append(out.Audit.Local, LocalEvidence{call.Function.Name, arguments, encoded})
				messages = append(messages, map[string]any{"role": "tool", "tool_call_id": call.ID, "content": string(encoded)})
			}

			payload["messages"] = messages
			continue
		}
		if candidate.Finish != "stop" {
			return out, errors.New("Réponse IA tronquée ou refusée")
		}
		if strings.TrimSpace(candidate.Message.Content) == "" {
			return out, errors.New("Réponse modèle vide")
		}
		out.Text = candidate.Message.Content
		return out, nil
	}
	return out, &ProtocolError{Code: "tool_round_limit"}
}

// Protocol errors carry a stable private code, without provider-controlled text.
type ProtocolError struct{ Code string }

func (e *ProtocolError) Error() string { return "Protocole des outils invalide" }

func serverToolCalls(raw json.RawMessage) (int, bool) {
	var usage struct {
		Details *struct {
			Calls *int `json:"tool_calls_executed"`
		} `json:"server_tool_use_details"`
		Tools map[string]*int `json:"server_tool_use"`
	}
	if json.Unmarshal(raw, &usage) != nil {
		return 0, false
	}
	if usage.Details != nil && usage.Details.Calls != nil && *usage.Details.Calls >= 0 && *usage.Details.Calls <= 30 {
		return *usage.Details.Calls, true
	}
	// Partial counters are useful diagnostics but cannot refund a reservation.
	// In particular, absence of fetch usage does not prove no fetch happened.
	if len(usage.Tools) == 0 {
		return 0, false
	}
	total := 0
	for name, value := range usage.Tools {
		if value == nil {
			return 0, false
		}
		count := *value
		if count < 0 || count > 30 {
			return 0, false
		}
		switch name {
		case "web_search_requests", "web_fetch_requests":
			total += count
		default:
			return 0, false
		}
	}
	_, search := usage.Tools["web_search_requests"]
	_, fetch := usage.Tools["web_fetch_requests"]
	return total, search && fetch
}
