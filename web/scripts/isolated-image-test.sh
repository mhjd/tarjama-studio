#!/bin/sh
set -eu
# Synthetic files only. No broker API, credentials, published port or infrastructure change.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
fixture="$ROOT/web/.cache/media/arhigh.mp4"
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
      tarjama-media:review isolated-tool "$@"
}
run probe probe
test -s "$work/probe/stdout"
run audio audio 123 1234
test -s "$work/audio/audio.flac"
run video normalize 160 90 high
test -s "$work/video/result.mp4"
echo 'Synthetic image probe, fractional FLAC and MP4 passed under network-none/default protections.'
echo 'This does not qualify the real broker path, maximum sizes or YouTube.'
