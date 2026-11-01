"""Offline timing comparison against an explicitly requested French Groq audit.

Does not alter the project, takes, captions or render. Text remains in files.
"""
import argparse
from difflib import SequenceMatcher
import json
import math
import os
from pathlib import Path
import re
import statistics
import sys
import unicodedata
import urllib.error
import urllib.request
import uuid

from tts_export import Paragraph, file_hash, run
from web_subtitles import remap_segments, voice_timed_segments
from workspace import CLIError, load_project, read_json, write_json


def tokens(text):
    text = unicodedata.normalize("NFKD", text.casefold())
    return re.findall(r"[a-z0-9]+", "".join(c for c in text if not unicodedata.combining(c)))


def read_srt(path):
    def milliseconds(text):
        match = re.fullmatch(r"(\d+):([0-5]\d):([0-5]\d),(\d{3})", text.strip())
        if not match:
            raise CLIError("Timecode SRT invalide.")
        h, m, s, ms = map(int, match.groups())
        return ((h * 60 + m) * 60 + s) * 1000 + ms
    rows = []
    for block in re.split(r"\n\s*\n", path.read_text().strip()):
        lines = block.splitlines()
        a, b = lines[1].split(" --> ")
        rows.append({"id": lines[0], "start_ms": milliseconds(a), "end_ms": milliseconds(b),
                     "french": " ".join(lines[2:])})
    return rows


def compare(rows, words, seconds):
    rows = [r for r in rows if r["start_ms"] >= 0 and r["end_ms"] <= seconds * 1000]
    expected, spans = [], []
    for row in rows:
        start = len(expected)
        expected.extend(tokens(row["french"]))
        spans.append((start, len(expected)))
    recognized, bounds = [], []
    invalid = set()
    for i, word in enumerate(words):
        a, b = word["start"], word["end"]
        if not math.isfinite(a) or not math.isfinite(b) or a < 0 or b <= a:
            invalid.add(i)
        if i and a < words[i - 1]["start"]:
            invalid.update((i - 1, i))
    if len(invalid) > .05 * len(words):
        raise CLIError("Repères STT invalides/non monotones : audit refusé.")
    for i, word in enumerate(words):
        a, b = word["start"], word["end"]
        if b > seconds:
            continue
        ts = tokens(word["word"])
        recognized.extend(ts)
        bounds.extend([None if i in invalid else (round(a * 1000), round(b * 1000))] * len(ts))
    matches = {}
    for block in SequenceMatcher(None, expected, recognized, autojunk=False).get_matching_blocks():
        # Ignore isolated coincidences; preserve monotone global text order.
        if block.size >= 3:
            matches.update((block.a + j, block.b + j) for j in range(block.size))
    details = []
    for row, (a, b) in zip(rows, spans):
        coverage = sum(i in matches for i in range(a, b)) / max(1, b - a)
        if coverage < .8 or a not in matches or b - 1 not in matches:
            continue
        if bounds[matches[a]] is None or bounds[matches[b - 1]] is None:
            continue
        start = bounds[matches[a]][0]
        end = bounds[matches[b - 1]][1]
        details.append({"id": row["id"], "coverage": coverage,
                        "start_delta_ms": row["start_ms"] - start,
                        "end_delta_ms": row["end_ms"] - end})
    errors = sorted(abs(d[k]) for d in details for k in ("start_delta_ms", "end_delta_ms"))
    def percentile(p):
        return errors[min(len(errors) - 1, math.ceil(p * len(errors)) - 1)] if errors else None
    summary = {"eligible_cues": len(rows), "measured_cues": len(details),
               "reference_words_excluded_for_bad_timing": len(invalid),
               "matched_token_fraction": round(len(matches) / max(1, len(expected)), 4),
               "boundary_abs_median_ms": statistics.median(errors) if errors else None,
               "boundary_abs_p90_ms": percentile(.9), "boundary_abs_p95_ms": percentile(.95),
               "boundary_abs_max_ms": max(errors) if errors else None,
               "boundaries_over_200ms": sum(e > 200 for e in errors),
               "boundaries_over_400ms": sum(e > 400 for e in errors),
               "boundaries_over_500ms": sum(e > 500 for e in errors),
               "boundaries_over_1s": sum(e > 1000 for e in errors),
               "boundaries_over_2s": sum(e > 2000 for e in errors), "measured_boundaries": len(errors)}
    return {"summary": summary, "cue_deltas": details}


def groq(audio, model):
    key = os.environ.get("GROQ_API_KEY", "")
    if os.environ.get("GROQ_API_KEY_FILE"):
        key = Path(os.environ["GROQ_API_KEY_FILE"]).read_text().strip()
    if not key.strip():
        raise CLIError("GROQ_API_KEY ou GROQ_API_KEY_FILE absent.")
    boundary = uuid.uuid4().hex
    fields = [("model", model), ("language", "fr"), ("temperature", "0"),
              ("response_format", "verbose_json"), ("timestamp_granularities[]", "word"),
              ("timestamp_granularities[]", "segment")]
    body = b"".join((f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n').encode()
                    for k, v in fields)
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="audit.flac"\r\n'
             'Content-Type: audio/flac\r\n\r\n').encode() + audio.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request("https://api.groq.com/openai/v1/audio/transcriptions", data=body,
                  headers={"Authorization": "Bearer " + key.strip(), "Content-Type": "multipart/form-data; boundary=" + boundary,
                           "User-Agent": "Tarjama-Studio-CLI/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise CLIError(f"Audit Groq HTTP {exc.code} ; aucune modification du projet.") from None


def audit(export, project, output, seconds=600, model="whisper-large-v3"):
    output.mkdir(parents=True, exist_ok=True)
    timing = read_json(export / "timing.json")
    plan = read_json(Path(timing["source_export"]) / "plan.json")
    source = load_project(project, translated=True)
    identity = {"voice_sha256": file_hash(export / "voice.wav"), "seconds": seconds, "model": model,
                "language": "fr", "timing_sha256": file_hash(export / "timing.json")}
    if (output / "identity.json").exists() and read_json(output / "identity.json") != identity:
        raise CLIError("Un autre audit existe : choisir un nouveau dossier.")
    write_json(output / "identity.json", identity)
    response_file = output / "groq-response.json"
    if not response_file.exists():
        audio = output / "voice-first-10min.flac"
        run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(export / "voice.wav"), "-t", str(seconds),
             "-ar", "16000", "-ac", "1", "-c:a", "flac", str(audio)])
        print(f"Audit Groq français : {seconds:g} s de doublage seul…", flush=True)
        write_json(response_file, groq(audio, model))
    words = read_json(response_file).get("words", [])
    if not words:
        raise CLIError("Aucun repère de mot STT : audit impossible.")
    groups = [Paragraph(**g) for g in plan["paragraphs"]]
    baseline = remap_segments(source, groups, timing["pieces"])
    import wave
    natural = []
    for i in range(len(groups)):
        with wave.open(str(Path(timing["source_export"]) / f"{i:04d}-raw.wav")) as wav:
            natural.append(wav.getnframes() / wav.getframerate())
    regions = read_json(export / "speech-mix.json")["french_speech_regions"]
    voice, _ = voice_timed_segments(baseline, groups, [Paragraph(**g) for g in timing["paragraphs"]], natural, regions)
    common = {r["id"] for r in voice if r["end_ms"] <= seconds * 1000} & {
              r["id"] for r in baseline if r["end_ms"] <= seconds * 1000}
    result = {"identity": identity, "stt_reference_is_approximate": True,
              "method": "monotone exact normalized text runs >=3 tokens; >=80% cue coverage and both endpoints matched",
              "voice": compare([r for r in voice if r["id"] in common], words, seconds),
              "video_baseline": compare([r for r in baseline if r["id"] in common], words, seconds),
              "rendered_srt": compare(read_srt(export / "subtitles.srt"), words, seconds)}
    result["groq_response_sha256"] = file_hash(response_file)
    write_json(output / "report.json", result)
    print(json.dumps({k: result[k]["summary"] for k in ("voice", "video_baseline", "rendered_srt")}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=Path, required=True)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=float, default=600)
    args = parser.parse_args()
    try:
        if not math.isfinite(args.seconds) or not 1 <= args.seconds <= 600:
            raise CLIError("Audit limité à 1–600 secondes.")
        audit(args.export.resolve(), args.project, args.output.resolve(), args.seconds)
    except (CLIError, OSError, ValueError, KeyError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1)
