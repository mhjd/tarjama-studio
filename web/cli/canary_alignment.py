"""Canary 180M French timing trial; immutable audio and existing subtitle text.

Official NeMo runtime, experimental word timestamps, no paid API. Recognition
stays on disk. Only exact, monotone text matches may move subtitle boundaries.
"""
import argparse
import copy
import importlib.metadata
import json
import math
from pathlib import Path
import shutil
import statistics
import sys
import time
import wave

from audit_subtitle_timing import compare
from align_subtitles import readable_ends, speech_coverage
from tts_export import Paragraph, file_hash, run, voice_slot
from web_subtitles import remap_segments, voice_timed_segments
from workspace import CLIError, ROOT, atomic_write, load_project, project_file, read_json, write_json

MODEL = "nvidia/canary-180m-flash"
REVISION = "b12ab418510d093e83890178fd0e8b0d0f7918a6"


def matched_rows(rows, group, placement, words, duration):
    """No transcription substitution, extrapolation, or cross-take drift.

    compare() requires exact runs >=3 normalized tokens, >=80% cue coverage,
    and both cue endpoints present. Refuse incomplete trials rather than hide
    guessed timings behind an apparent successful export.
    """
    local = copy.deepcopy(rows)
    # compare needs all rows inside its reference window; old times are not used
    # as anchors. Store STT endpoint estimates through its signed differences.
    for row in local:
        row.update(start_ms=0, end_ms=1)
    result = compare(local, words, duration)
    deltas = {d["id"]: d for d in result["cue_deltas"]}
    origin, limit = voice_slot(placement)
    aligned, missing = [], []
    for row in rows:
        if row["id"] not in deltas:
            missing.append(row["id"])
            continue
        d = deltas[row["id"]]
        a, b = -d["start_delta_ms"], 1 - d["end_delta_ms"]
        if not 0 <= a < b <= duration * 1000 + 100:
            raise CLIError("Bornes Canary invalides ; aucune source modifiée.")
        aligned.append(dict(row, start_ms=origin + a, end_ms=min(limit, origin + b)))
    if any(a["end_ms"] > b["start_ms"] for a, b in zip(aligned, aligned[1:])):
        raise CLIError("Bornes Canary chevauchantes ; aucun export validé.")
    return aligned, missing, {k: result["summary"][k] for k in
        ("eligible_cues", "measured_cues", "matched_token_fraction", "reference_words_excluded_for_bad_timing")}


def compare_with_full_context(rows, context, words, seconds):
    """Keep omitted cues in text matching, then score only available timings.

    Removing missing cues before matching can associate repeated phrases with
    the wrong occurrence in the STT reference. Full text context avoids that.
    """
    reference = compare(context, words, seconds)
    by_id = {r["id"]: r for r in context}
    expected = {d["id"]: (by_id[d["id"]]["start_ms"] - d["start_delta_ms"],
                           by_id[d["id"]]["end_ms"] - d["end_delta_ms"]) for d in reference["cue_deltas"]}
    eligible = [r for r in rows if 0 <= r["start_ms"] < r["end_ms"] <= seconds * 1000]
    deltas = [{"id": r["id"], "start_delta_ms": r["start_ms"] - expected[r["id"]][0],
               "end_delta_ms": r["end_ms"] - expected[r["id"]][1]} for r in eligible if r["id"] in expected]
    errors = sorted(abs(d[k]) for d in deltas for k in ("start_delta_ms", "end_delta_ms"))
    summary = {"eligible_cues": len(eligible), "measured_cues": len(deltas), "measured_boundaries": len(errors),
               "boundary_abs_median_ms": statistics.median(errors) if errors else None,
               "boundary_abs_max_ms": max(errors, default=None)}
    for p in (90, 95):
        summary[f"boundary_abs_p{p}_ms"] = errors[math.ceil(p / 100 * len(errors)) - 1] if errors else None
    for threshold in (200, 400, 500, 1000, 2000):
        summary[f"boundaries_over_{threshold}ms"] = sum(e > threshold for e in errors)
    return {"summary": summary, "cue_deltas": deltas, "full_text_context_summary": reference["summary"]}


def windows(duration, regions, maximum=10):
    """Non-overlapping analysis windows, prefer real silence near 10 seconds."""
    pauses = [(b + c) / 2000 for (_, b), (c, _) in zip(regions, regions[1:]) if c - b >= 150]
    start = 0
    result = []
    while start < duration:
        end = min(duration, start + maximum)
        candidates = [p for p in pauses if start + maximum - 2 <= p <= end]
        if end < duration and candidates:
            end = max(candidates)
        result.append((start, end))
        start = end
    return result


def absolute_words(stamps, start, end):
    words = []
    for stamp in stamps:
        a, b = float(stamp["start"]), float(stamp["end"])
        if not math.isfinite(a) or not math.isfinite(b) or not 0 <= a < b <= end - start + .08:
            raise CLIError(f"Timestamp Canary hors fenêtre : début={a:g}, fin={b:g}, durée={end-start:g} s ; diagnostic conservé.")
        # Model timestamps are quantized. A final tick may exceed the physical
        # analysis window by a few ms; cap there, never into the next window.
        b = min(end, start + b)
        a += start
        if b <= a:
            raise CLIError("Mot Canary sans durée dans sa fenêtre.")
        words.append({"word": stamp["word"], "start": a, "end": b})
    return words


class CanaryRecognizer:
    def __init__(self, path, device="cpu", context_seconds=0):
        import torch
        from nemo.collections.asr.models import EncDecMultiTaskModel
        from nemo.utils import logging
        logging.set_verbosity(logging.ERROR)
        torch.set_num_threads(min(8, __import__("os").cpu_count() or 2))
        self.device = device
        self.context_seconds = context_seconds
        self.model = EncDecMultiTaskModel.restore_from(str(path), map_location="cpu").eval()
        if self.device == "mps":
            # NeMo's evaluation counters contain float64 buffers, unsupported by
            # MPS. Only those counters change dtype; model weights stay FP32.
            self.model._apply(lambda value: value.float() if value.dtype == torch.float64 else value)
        self.model.to(self.device)
        config = self.model.cfg.decoding
        config.beam.beam_size = 1
        self.model.change_decoding_strategy(config)

    def recognize(self, audio, analysis, duration, regions):
        words, parts, excluded = [], [], []
        margin = self.context_seconds
        for index, (core_start, core_end) in enumerate(windows(duration, regions, 10 - 2 * margin)):
            start, end = max(0, core_start - margin), min(duration, core_end + margin)
            clip = analysis / f"part-{index:03d}.wav"
            run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(start), "-i", str(audio),
                 "-t", str(end - start), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(clip)])
            manifest = analysis / f"part-{index:03d}.jsonl"
            atomic_write(manifest, (json.dumps({"audio_filepath": str(clip.resolve()), "duration": end - start,
                "source_lang": "fr", "target_lang": "fr", "pnc": "yes", "timestamp": "yes"}) + "\n").encode())
            hypothesis = self.model.transcribe(str(manifest), batch_size=1, timestamps=True,
                                                return_hypotheses=True, verbose=False)[0]
            stamps = hypothesis.timestamp.get("word", [])
            parts.append({"start": start, "end": end, "core_start": core_start, "core_end": core_end,
                          "text": hypothesis.text, "timestamps": stamps})
            write_json(analysis / f"part-{index:03d}-recognition.json", parts[-1])
            for word_index, stamp in enumerate(stamps):
                midpoint = start + (float(stamp["start"]) + float(stamp["end"])) / 2
                if not core_start <= midpoint < core_end:
                    continue
                try:
                    selected = absolute_words([stamp], start, end)[0]
                    # Each window owns only its central interval, so overlap
                    # cannot duplicate elapsed time or accumulate drift.
                    selected["start"] = max(core_start, selected["start"])
                    selected["end"] = min(core_end, selected["end"])
                    words.append(selected)
                except CLIError as exc:
                    excluded.append({"part": index, "word_index": word_index, "reason": str(exc)})
        return {"parts": parts, "words": words, "excluded": excluded}


def trial(args):
    output, export = args.output.resolve(), args.export.resolve()
    if output == export or output.exists():
        raise CLIError("Choisir un nouveau dossier d'essai Canary, sans écraser un export.")
    timing = read_json(export / "timing.json")
    raw = Path(timing["source_export"])
    if file_hash(raw / "plan.json") != timing["source_plan_sha256"]:
        raise CLIError("Plan source modifié.")
    plan = read_json(raw / "plan.json")
    count = sum(p["start_ms"] < args.seconds * 1000 for p in timing["paragraphs"])
    groups = [Paragraph(**p) for p in plan["paragraphs"][:count]]
    mapped = [Paragraph(**p) for p in timing["paragraphs"][:count]]
    source = load_project(args.project, translated=True)
    baseline = remap_segments(source, groups, timing["pieces"])
    natural = []
    for i in range(count):
        audio = raw / f"{i:04d}-raw.wav"
        if file_hash(audio) != read_json(raw / f"{i:04d}.json")["raw_sha256"]:
            raise CLIError("Prise source modifiée.")
        with wave.open(str(audio)) as wav:
            natural.append(wav.getnframes() / wav.getframerate())
    vad = read_json(export / "speech-mix.json")["french_speech_regions"][:count]
    linear, _ = voice_timed_segments(baseline, groups, mapped, natural, vad)
    by_id = {r["id"]: r for r in linear}
    output.mkdir(parents=True)
    from huggingface_hub import hf_hub_download
    path = Path(hf_hub_download(MODEL, "canary-180m-flash.nemo", revision=REVISION))
    identity = {"model": MODEL, "revision": REVISION, "model_sha256": file_hash(path),
                "source_plan_sha256": file_hash(raw / "plan.json"), "timing_sha256": file_hash(export / "timing.json"),
                "project_sha256": file_hash(project_file(args.project)),
                "voice_sha256": file_hash(export / "voice.wav"), "seconds": args.seconds,
                "runtime": "NeMo", "window_seconds": 10, "context_seconds": args.context_seconds, "language": "fr",
                "script_sha256": file_hash(Path(__file__)), "packages": {name: importlib.metadata.version(name)
                    for name in ("nemo-toolkit", "torch", "torchaudio")}}
    write_json(output / "identity.json", identity)
    shutil.copyfile(__file__, output / "canary-engine.py")
    start = time.monotonic()
    recognizer = CanaryRecognizer(path, args.device, args.context_seconds)
    identity["device"] = recognizer.device
    write_json(output / "identity.json", identity)
    aligned, missing, diagnostics, excluded = [], [], [], []
    from subtitle_audio import energy_regions
    energy = [energy_regions(raw / f"{i:04d}-raw.wav") for i in range(count)]
    for i, (group, placement, duration) in enumerate(zip(groups, mapped, natural)):
        print(f"Canary français {i + 1}/{count}", flush=True)
        analysis = output / f"take-{i:04d}"
        analysis.mkdir()
        result = recognizer.recognize(raw / f"{i:04d}-raw.wav", analysis, duration, energy[i])
        write_json(analysis / "recognition.json", result)
        excluded.extend(dict(x, take=i) for x in result["excluded"])
        rows, absent, summary = matched_rows([by_id[sid] for sid in group.ids], group, placement, result["words"], duration)
        aligned.extend(rows)
        missing.extend(absent)
        diagnostics.append(summary)
    write_json(output / "matching.json", {"takes": diagnostics, "unmatched_ids": missing, "invalid_timestamps": excluded})
    exact = aligned
    # Partial matches are useful diagnostics, never a silently incomplete export.
    aligned = readable_ends(exact, groups, mapped, energy) if not missing else exact
    write_json(output / "word-aligned-segments.json", exact)
    write_json(output / "aligned-segments.json", aligned)
    report = {"identity": identity, "elapsed_seconds": time.monotonic() - start,
              "total_cues": len(linear), "matched_cues": len(aligned), "unmatched_ids": missing,
              "excluded_invalid_words": len(excluded), "export_allowed": not missing,
              "audio_coverage": speech_coverage(aligned, groups, mapped, energy, args.seconds)}
    if args.audit:
        if identity["voice_sha256"] != read_json(args.audit / "identity.json")["voice_sha256"]:
            raise CLIError("Audit STT d'une autre piste française.")
        reference = read_json(args.audit / "groq-response.json")["words"]
        common = {r["id"] for r in aligned}
        report.update(reference_is_approximate_not_ground_truth=True, reference_seconds=600,
                      reference_sha256=file_hash(args.audit / "groq-response.json"),
                      linear=compare_with_full_context([r for r in linear if r["id"] in common], linear, reference, 600),
                      aligned=compare_with_full_context(aligned, linear, reference, 600))
    write_json(output / "report.json", report)
    if missing:
        raise CLIError(f"Canary : {len(missing)}/{len(linear)} sous-titres sans bornes suffisamment fiables ; rapport conservé, pas de rendu.")
    import subprocess
    response = subprocess.run([str(ROOT / "web/.cache/local-api")], input=json.dumps({"kind": "subtitles", "segments": aligned,
        "width": plan["media"]["width"], "height": plan["media"]["height"]}), text=True, capture_output=True, timeout=60)
    data = json.loads(response.stdout)
    if response.returncode or data.get("error"):
        raise CLIError("Rendu des sous-titres Canary refusé.")
    for key, name in (("ass", "subtitles.ass"), ("srt", "subtitles.srt")):
        atomic_write(output / name, data["result"][key].encode())
    for name in ("retimed-source.mkv", "voice.wav", "mix.ffscript"):
        (output / name).symlink_to((export / name).resolve(strict=True))
    timing.update(subtitle_timing="canary-180m-exact-matched-words")
    write_json(output / "timing.json", timing)
    print(json.dumps({"elapsed_seconds": report["elapsed_seconds"], "cues": len(aligned),
                      "audio_coverage": report["audio_coverage"],
                      "comparison": report.get("aligned", {}).get("summary")}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("export", "project", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--audit", type=Path)
    parser.add_argument("--seconds", type=float, default=900)
    parser.add_argument("--device", choices=("cpu", "mps"), default="cpu",
                        help="CPU fiable par défaut ; MPS expérimental selon la version de NeMo/PyTorch")
    parser.add_argument("--context-seconds", type=float, default=0,
                        help="Contexte de chaque côté des fenêtres, sans dépasser dix secondes d'audio analysé")
    args = parser.parse_args()
    try:
        if not math.isfinite(args.seconds) or not 1 <= args.seconds <= 900:
            raise CLIError("Essai limité à 1–900 secondes de sortie.")
        if not math.isfinite(args.context_seconds) or not 0 <= args.context_seconds <= 2:
            raise CLIError("Contexte d'analyse limité à 0–2 secondes.")
        trial(args)
    except (CLIError, OSError, ValueError, KeyError, ImportError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1)
