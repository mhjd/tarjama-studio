#!/bin/sh
set -eu
export TEST_UID=$(id -u) TEST_GID=$(id -g)
cleanup() { docker compose -f web/deploy/compose.test.yml down; }
trap cleanup EXIT
trap 'exit 130' INT TERM
docker compose -f web/deploy/compose.test.yml run --rm checks \
  go test -race -count=1 -tags reliability_audit -run '^TestReliabilityAudit$' -v ./internal/studio
