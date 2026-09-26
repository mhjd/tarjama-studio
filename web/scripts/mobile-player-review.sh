#!/bin/sh
set -eu
export TEST_UID=$(id -u) TEST_GID=$(id -g)
# Previously produced qualification sample, never live application storage.
sample_dir=web/.cache/real-ui-10min/ui-review-tenmin_iphone1
test -f "$sample_dir/transcription-iphone15.json"
test -f "$sample_dir/tarjama-gbrDbQVYDuQ-iphone15-fr-high.mp4"
cleanup() { docker compose -f web/deploy/compose.test.yml down; }
trap cleanup EXIT
trap 'exit 130' INT TERM
docker compose -f web/deploy/compose.test.yml run --rm \
  -e MOBILE_REVIEW_TEXT=/work/web/.cache/real-ui-10min/ui-review-tenmin_iphone1/transcription-iphone15.json \
  checks sh -c '
    mkdir -p /tmp/tarjama-storage
    cp /work/web/.cache/real-ui-10min/ui-review-tenmin_iphone1/tarjama-gbrDbQVYDuQ-iphone15-fr-high.mp4 /tmp/tarjama-storage/fixture.mp4
    cd /work/web/frontend
    npm run build
    npx playwright test --config mobile-review.config.ts
  '
