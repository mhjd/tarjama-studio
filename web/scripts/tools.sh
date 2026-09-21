#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
mkdir -p "$ROOT/web/.cache/go" "$ROOT/web/.cache/build" "$ROOT/web/.cache/npm"
exec docker run --rm --init --cpus=2 --memory=3g --pids-limit=256 --user "$(id -u):$(id -g)" \
 -e GOMODCACHE=/work/web/.cache/go -e GOCACHE=/work/web/.cache/build -e npm_config_cache=/work/web/.cache/npm \
 -v "$ROOT:/work" -w /work/web/backend tarjama-web-tools:test "$@"
