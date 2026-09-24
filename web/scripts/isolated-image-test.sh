#!/bin/sh
set -eu
# Synthetic files only. No broker API, credentials, published port or infrastructure change.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
fixture="$ROOT/web/.cache/media/arhigh.mp4"
image=${MEDIA_TEST_IMAGE:-tarjama-media:review}
test -s "$fixture" || { echo 'Run make web-test first (synthetic media fixture missing)' >&2; exit 1; }
work=$(mktemp -d "$ROOT/web/.cache/isolated-image.XXXXXX")
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
trap 'exit 130' INT TERM
mkdir "$work/input" "$work/probe" "$work/audio" "$work/video"
chmod 755 "$work" "$work/input"
chmod 777 "$work/probe" "$work/audio" "$work/video"
cp "$fixture" "$work/input/media"
chmod 644 "$work/input/media"
run() {
    result="$1"; shift
    docker run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges=true --user 10002:10002 \
      --cpus 2 --memory 768m --pids-limit 128 \
      --tmpfs /tmp:rw,nosuid,nodev,size=96m \
      -v "$work/input:/inputs:ro" -v "$work/$result:/outputs" \
      "$image" isolated-tool "$@"
}
run probe probe
test -s "$work/probe/stdout"
run audio audio 123 1234
test -s "$work/audio/audio.flac"
run video normalize 160 90 high
test -s "$work/video/result.mp4"
# The fixed proxy is deliberately absent in this network-none synthetic test.
# No YouTube request or application secret is possible; verify diagnostic transport.
if run video download 'https://www.youtube.com/watch?v=abcdefghijk' audio >"$work/download.stdout" 2>"$work/download.stderr"; then
    echo 'Download unexpectedly succeeded without the administered relay' >&2
    exit 1
fi
grep -q 'error_category=connection_refused' "$work/download.stderr"
if grep -qE 'https?://' "$work/download.stderr"; then
    echo 'Unredacted URL in private diagnostic' >&2
    exit 1
fi
echo 'Private download diagnostic passed without network or credentials.'
echo 'Synthetic image probe, fractional FLAC and MP4 passed under network-none/default protections.'
echo 'This does not qualify the real broker path, maximum sizes or YouTube.'
