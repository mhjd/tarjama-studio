package studio

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"tarjama/web/internal/research"
)

const maxTextChunkAttempts = 4

var errTextBudget = errors.New("Budget de tentatives automatiques atteint")

// Reserve BEFORE contacting the provider. A crash/unknown billing consumes a
// slot too. Only an explicit first-request 429 without usage refunds the slot.
func (s *Store) beginTextAttempt(ctx context.Context, j Job, ordinal int) (string, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if err = checkLease(ctx, tx, j); err != nil {
		return "", err
	}
	var total, chunk int
	err = tx.QueryRow(ctx, `SELECT count(*), count(*) FILTER(WHERE ordinal=$3) FROM text_attempts WHERE job_id=$1 AND epoch=$2 AND consumes_budget`, j.ID, j.TextEpoch, ordinal).Scan(&total, &chunk)
	if err != nil {
		return "", err
	}
	// Splitting may create new ordinals, so a second, whole-job bound is needed.
	if chunk >= maxTextChunkAttempts || total >= max(12, 4*len(TextChunks(j.Input.Segments))) {
		return "", errTextBudget
	}
	attempt := id()
	_, err = tx.Exec(ctx, `INSERT INTO text_attempts(id,job_id,epoch,ordinal,diagnostics) VALUES($1,$2,$3,$4,jsonb_build_object('model',$5::text,'prompt_version',$6::text,'reasoning_effort','medium'))`, attempt, j.ID, j.TextEpoch, ordinal, TextModel, PromptVersion(j.Kind))
	if err != nil {
		return "", err
	}
	return attempt, tx.Commit(ctx)
}

func (s *Store) finishTextAttempt(ctx context.Context, attempt string, elapsed time.Duration, result TextResult, failure error) error {
	var audit research.Audit
	_ = json.Unmarshal(result.Grounding, &audit)
	// Strict metadata allowlist: no model response, prompt, arguments, references,
	// provider error text or arbitrary usage fields enter the attempt journal.
	usages := []map[string]float64{}
	billingIncomplete := audit.ModelCalls == 0 || len(audit.ModelUsage) < audit.ModelCalls
	for _, raw := range audit.ModelUsage {
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil {
			billingIncomplete = true
			continue
		}
		entry := map[string]float64{}
		for _, key := range []string{"prompt_tokens", "completion_tokens", "input_tokens", "output_tokens", "total_tokens", "cost"} {
			var value float64
			if json.Unmarshal(fields[key], &value) == nil && value >= 0 {
				entry[key] = value
			}
		}
		if _, knownCost := entry["cost"]; !knownCost {
			billingIncomplete = true
		}
		usages = append(usages, entry)
	}
	// Request identifiers are bounded metadata, not free-form provider text.
	ids := []string{}
	for _, requestID := range audit.RequestIDs {
		if safeID.MatchString(requestID) {
			ids = append(ids, requestID)
		}
	}
	code := "ok"
	if failure != nil {
		code = jobFailureReason(failure)
	}
	var provider *ProviderError
	refund := errors.As(failure, &provider) && provider.QuotaRejected && audit.ModelCalls == 1 && len(audit.ModelUsage) == 0
	metadata, err := json.Marshal(map[string]any{
		"model": TextModel, "elapsed_ms": elapsed.Milliseconds(), "request_ids": ids,
		"model_calls": audit.ModelCalls, "local_results": len(audit.Local), "local_calls": audit.LocalCalls, "web_calls": audit.WebCalls,
		"web_usage_unknown": audit.WebUsageUnknown, "usage": usages,
		"billing_may_be_incomplete": billingIncomplete,
	})
	if err != nil {
		return err
	}
	// Preserve failure diagnostics even when the request was cancelled; bounded DB
	// write only. Never continue model execution under this detached context.
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_, err = s.DB.Exec(saveCtx, `UPDATE text_attempts SET finished_at=now(),code=$2,diagnostics=diagnostics || $3::jsonb,consumes_budget=$4 WHERE id=$1 AND finished_at IS NULL`, attempt, code, metadata, !refund)
	return err
}
