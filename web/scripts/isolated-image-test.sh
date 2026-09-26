#!/bin/sh
set -eu
# Synthetic files only. No broker API, credentials, published port or infrastructure change.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
fixture="$ROOT/web/.cache/media/arhigh.mp4"
image=${MEDIA_TEST_IMAGE:-tarjama-media:review}
cpus=${MEDIA_TEST_CPUS:-2}
case "$cpus" in
    2) render_threads= ;;
    4) render_threads=4 ;;
    *) echo 'MEDIA_TEST_CPUS must be 2 or 4' >&2; exit 1 ;;
esac
test -s "$fixture" || { echo 'Run make web-test first (synthetic media fixture missing)' >&2; exit 1; }
work=$(mktemp -d "$ROOT/web/.cache/isolated-image.XXXXXX")
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
trap 'exit 130' INT TERM
mkdir "$work/input" "$work/probe" "$work/audio" "$work/video" "$work/copy" "$work/export"
chmod 755 "$work" "$work/input"
chmod 777 "$work/probe" "$work/audio" "$work/video" "$work/copy" "$work/export"
cp "$fixture" "$work/input/media"
chmod 644 "$work/input/media"
run() {
    result="$1"; shift
    docker run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges=true --user 10002:10002 \
      --cpus "$cpus" --memory 768m --pids-limit 128 \
      --tmpfs /tmp:rw,nosuid,nodev,size=96m \
      -v "$work/input:/inputs:ro" -v "$work/$result:/outputs" \
      "$image" isolated-tool "$@"
}
run probe probe
test -s "$work/probe/stdout"
run audio audio 123 1234
test -s "$work/audio/audio.flac"
run video normalize 160 90 high ${render_threads:+"$render_threads"}
test -s "$work/video/result.mp4"
# Reuse the compatible result: this second normalization must use remux.
cp "$work/video/result.mp4" "$work/input/media"
run copy normalize 160 90 high ${render_threads:+"$render_threads"}
test -s "$work/copy/result.mp4"
cat > "$work/input/subtitles.ass" <<'ASS'
[Script Info]
ScriptType: v4.00+
PlayResX: 160
PlayResY: 90
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Noto Sans,12,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,3,1,0,2,5,5,5,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,Été — sous-titres.
ASS
chmod 644 "$work/input/subtitles.ass"
run export export 160 90 high ${render_threads:+"$render_threads"}
test -s "$work/export/result.mp4"
# Offline inspection of synthetic files only; no runtime/production mounts.
docker run --rm -i --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges=true --user 10002:10002 \
  --cpus 1 --memory 256m --pids-limit 64 --entrypoint timeout \
  -v "$work:/fixture:ro" "$image" -k 5 60 python3 - <<'PY'
import json
import subprocess

def hashes(path, stream):
    raw = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', stream,
        '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash',
        '-of', 'json', path], timeout=15)
    return [p['data_hash'] for p in json.loads(raw)['packets']]

source = '/fixture/input/media'
copied = '/fixture/copy/result.mp4'
exported = '/fixture/export/result.mp4'
assert hashes(source, 'v:0') == hashes(copied, 'v:0'), 'normalization re-encoded video'
assert hashes(source, 'a:0') == hashes(copied, 'a:0'), 'normalization re-encoded AAC'
assert hashes(source, 'a:0') == hashes(exported, 'a:0'), 'export re-encoded AAC'
assert hashes(source, 'v:0') != hashes(exported, 'v:0'), 'ASS export skipped encoding'
for path in [copied, exported]:
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-threads', '1', '-i', path,
        '-map', '0:v:0', '-map', '0:a:0', '-threads', '1', '-f', 'null', '-'],
        check=True, timeout=15, stdout=subprocess.DEVNULL)
print('Packet identity, subtitle rendering and full output decode passed in the candidate image.')
PY
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
