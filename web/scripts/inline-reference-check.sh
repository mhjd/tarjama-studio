#!/bin/sh
# Opt-in paid test: one generation, at most six model requests, no retry loop.
# Uses the real application prompt/provider and the local corpus; no app DB.
set -eu
: "${REFERENCE_CHECK_INPUT:=web/review/inline-references-20260930/sirat.json}"
: "${REFERENCE_CHECK_CHUNK:=-1}"
: "${REFERENCE_CHECK_OUTPUT:?Set a new result directory}"
: "${OPENROUTER_API_KEY_FILE:=/etc/vps-agent-secrets/openrouter.api_key}"
: "${REFERENCE_CORPUS_DIR:=data/reference_corpus/20260925-v2}"
export OPENROUTER_API_KEY_FILE REFERENCE_CORPUS_DIR
web/scripts/tools.sh go build -o /work/web/.cache/inline-text-benchmark ./cmd/text-benchmark
exec timeout --signal=TERM --kill-after=10s 420s web/.cache/inline-text-benchmark \
  --input "$REFERENCE_CHECK_INPUT" --chunk-index "$REFERENCE_CHECK_CHUNK" \
  --output "$REFERENCE_CHECK_OUTPUT"
