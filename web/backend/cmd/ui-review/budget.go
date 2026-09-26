package main

// Qualification-only reservation ledger. This is not a user billing feature.
import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type paidAttempt struct {
	Provider string   `json:"provider"`
	Reserved float64  `json:"reserved_usd"`
	Cost     *float64 `json:"reported_cost_usd,omitempty"`
}
type reviewBudget struct {
	mu       sync.Mutex
	path     string
	Deadline time.Time     `json:"deadline"`
	Calls    []paidAttempt `json:"calls"`
	Limit    float64       `json:"limit_usd"`
}

func openReviewBudget(path string) (*reviewBudget, error) {
	b := &reviewBudget{path: path, Deadline: time.Now().Add(90 * time.Minute), Limit: 2}
	raw, err := os.ReadFile(path)
	if err == nil {
		err = json.Unmarshal(raw, b)
	} else if os.IsNotExist(err) {
		err = b.save()
	}
	return b, err
}
func (b *reviewBudget) save() error {
	raw, err := json.MarshalIndent(b, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.OpenFile(b.path+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(raw)
	if err == nil {
		err = f.Sync()
	}
	ce := f.Close()
	if err == nil {
		err = ce
	}
	if err != nil {
		return err
	}
	if err = os.Rename(b.path+".tmp", b.path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(b.path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func (b *reviewBudget) reserve(provider string, amount float64) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	committed := 0.0
	for _, call := range b.Calls {
		if call.Cost != nil {
			committed += *call.Cost
		} else {
			committed += call.Reserved
		}
	}
	// Two seven-chunk text passes can legitimately need 84 HTTP requests
	// (six bounded research/finalization rounds each), plus ASR and the short run.
	// The independent persistent dollar reservation remains the primary guard.
	if time.Now().After(b.Deadline) || len(b.Calls) >= 120 || committed+amount > b.Limit {
		return 0, errors.New("qualification budget exhausted")
	}
	index := len(b.Calls)
	b.Calls = append(b.Calls, paidAttempt{Provider: provider, Reserved: amount})
	return index, b.save()
}
func (b *reviewBudget) settle(index int, cost float64) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.Calls[index].Cost = &cost
	return b.save()
}

// Reserve conservative upper-rate estimates before each request. Unknown usage
// retains the full reservation, including transport failures and process crashes.
func (t reviewTransport) paid(r *http.Request) (*http.Response, error) {
	provider := r.URL.Hostname()
	if t.budget == nil || (provider != "openrouter.ai" && provider != "api.groq.com") || r.Method != "POST" {
		return t.base.RoundTrip(r)
	}
	reserve := 0.03 // Groq: at most a ten-minute application chunk, $0.111/hour.
	if provider == "openrouter.ai" {
		if r.GetBody == nil {
			return nil, errors.New("qualification requires replayable model body")
		}
		reader, err := r.GetBody()
		if err != nil {
			return nil, err
		}
		raw, err := io.ReadAll(io.LimitReader(reader, 8*1024*1024+1))
		reader.Close()
		if err != nil || len(raw) > 8*1024*1024 {
			return nil, errors.New("qualification model body oversized")
		}
		var body struct {
			Model     string `json:"model"`
			MaxTokens int    `json:"max_tokens"`
			ToolCalls int    `json:"max_tool_calls"`
		}
		if json.Unmarshal(raw, &body) != nil || body.Model != "openai/gpt-6-luna" || body.MaxTokens < 1 || body.MaxTokens > 32768 || body.ToolCalls > 4 {
			return nil, errors.New("qualification model budget mismatch")
		}
		// Upper tier rates observed 2026-09-26; reserve all hidden server rounds,
		// context growth, output/reasoning and a $0.02 allowance per server tool.
		rounds := float64(1 + body.ToolCalls)
		input := float64(min(1050000, len(raw)+65536+body.ToolCalls*(12000+body.MaxTokens)))
		reserve = rounds*(input*0.0000002+float64(body.MaxTokens)*0.00000075) + float64(body.ToolCalls)*0.02
	}
	index, err := t.budget.reserve(provider, reserve)
	if err != nil {
		return nil, err
	}
	response, err := t.base.RoundTrip(r)
	if err != nil {
		return nil, err
	}
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, 4*1024*1024+1))
	response.Body = &reviewBody{Reader: io.MultiReader(bytes.NewReader(raw), response.Body), Closer: response.Body}
	if readErr == nil && len(raw) <= 4*1024*1024 {
		var usage struct {
			Usage struct {
				Cost *float64 `json:"cost"`
			} `json:"usage"`
		}
		if json.Unmarshal(raw, &usage) == nil && usage.Usage.Cost != nil && *usage.Usage.Cost >= 0 {
			if err = t.budget.settle(index, *usage.Usage.Cost); err != nil {
				response.Body.Close()
				return nil, err
			}
		}
	}
	return response, nil
}
