#!/bin/sh
set -eu
: "${PARALLEL_API_KEY_FILE:?Set a readable managed Parallel key file path, never its value}"
: "${OPENROUTER_API_KEY_FILE:?Set a readable managed OpenRouter key file path, never its value}"
: "${RESEARCH_RUN:?Set a new run name}"
case "$RESEARCH_RUN" in *[!a-zA-Z0-9_-]*|'') echo 'Invalid run name' >&2; exit 1;; esac
[ -r "$PARALLEL_API_KEY_FILE" ] && [ -r "$OPENROUTER_API_KEY_FILE" ] || { echo 'Managed credential file unavailable' >&2; exit 1; }
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
mkdir -p "$ROOT/data/model_outputs"
exec docker run --rm --init --read-only --cpus=1 --memory=256m --pids-limit=64 \
 --user "$(id -u):$(id -g)" --tmpfs /tmp:size=32m,mode=1777 \
 -v "$PARALLEL_API_KEY_FILE:/run/parallel/api_key:ro" \
 -v "$OPENROUTER_API_KEY_FILE:/run/openrouter/api_key:ro" \
 -v "$ROOT/data/model_outputs:/evidence" \
 -e PARALLEL_API_KEY_FILE=/run/parallel/api_key \
 -e OPENROUTER_API_KEY_FILE=/run/openrouter/api_key \
 tarjama-research-check:review --model deepseek/deepseek-v4.1-flash --output "/evidence/$RESEARCH_RUN"
