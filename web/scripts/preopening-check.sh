#!/bin/sh
set -eu
# Synthetic DB, internal Docker network, existing tools image, no live secrets.
export TEST_UID=$(id -u) TEST_GID=$(id -g)
cleanup() { docker compose -p tarjama-preopening-check -f web/deploy/compose.test.yml down; }
trap cleanup EXIT
trap 'exit 130' INT TERM
if [ "$#" -eq 0 ]; then
  set -- correction-lock.spec.ts workflow-navigation.spec.ts routes.spec.ts
fi
docker compose -p tarjama-preopening-check -f web/deploy/compose.test.yml run --rm checks sh -c '
  go test -race -count=1 -v ./internal/studio -run "Test(RawTranscriptionCannotBeEdited|RoutesCannotBypassWorkflowGuards|SubtitlesWithoutMediaAndAfterArabicEdit|AutomaticExportCuesDesktopExamples|ExportCueReadingBoundaries|GroupedASSKeepsEditingSegmentsAndSRT)$"
  cd /work/web/frontend
  npm run build
  npx playwright test "$@" --output ../.cache/preopening-check/playwright
' sh "$@"
