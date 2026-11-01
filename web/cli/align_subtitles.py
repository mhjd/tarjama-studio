"""Align known French TTS text locally; never transcribe or change project text."""
import argparse
import copy
import importlib.metadata
import json
import math
from pathlib import Path
import shutil
import sys
import time
import wave

from audit_subtitle_timing import compare, read_srt, tokens
from tts_export import Paragraph, atempo, file_hash, run, voice_slot
from web_subtitles import remap_segments, voice_timed_segments
from workspace import CLIError, ROOT, load_project, read_json, write_json, atomic_write, locked

# Official multilingual alignment heads, not all decoder heads:
# https://github.com/openai/whisper/blob/main/whisper/__init__.py
HEADS = {"base": b"ABzY8KQ!870{>%RzyTQH3`Q^yNP!>##QT-<FaQ7m",
         "small": b"ABzY8DmU6=0{>%Rpa?J`kvJ6qF(V^F86#Xh7JUGMK}P<N0000"}


def model_files(model_name):
    from huggingface_hub import snapshot_download
    folder = Path(snapshot_download(f"mlx-community/whisper-{model_name}-mlx"))
    files = [folder / "config.json", folder / "weights.safetensors"]
    if not files[-1].is_file():
        files[-1] = folder / "weights.npz"
    return folder, {p.name: file_hash(p) for p in files}


class WhisperAligner:
    def __init__(self, model_name="base", model_path=None):
        import mlx.core as mx
        from mlx_whisper.load_models import load_model
        from mlx_whisper.tokenizer import get_tokenizer
        self.mx = mx
        self.model = load_model(model_path or f"mlx-community/whisper-{model_name}-mlx", dtype=mx.float16)
        self.model.set_alignment_heads(HEADS[model_name])
        self.tokenizer = get_tokenizer(self.model.is_multilingual, num_languages=self.model.num_languages,
                                       language="fr", task="transcribe")

    def align(self, audio, text, analysis, duration):
        from mlx_whisper.audio import load_audio, log_mel_spectrogram, pad_or_trim, N_FRAMES, N_SAMPLES
        from mlx_whisper.timing import find_alignment, merge_punctuations
        # Each take is independent. Long takes are sped up only for analysis,
        # preserving pitch, so no guessed text/audio cuts are necessary.
        speed = max(1, duration / 28)
        run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(audio), "-af", atempo(speed),
             "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(analysis)])
        samples = load_audio(str(analysis))
        analysis_seconds = len(samples) / 16000
        if not 0 < analysis_seconds < 30:
            raise CLIError("Fenêtre d'alignement hors limites.")
        encoded = self.tokenizer.encode(" " + text.strip())
        if len(encoded) + len(self.tokenizer.sot_sequence) + 2 > self.model.dims.n_text_ctx:
            raise CLIError("Prise trop longue pour l'alignement local.")
        mel = log_mel_spectrogram(samples, n_mels=self.model.dims.n_mels, padding=N_SAMPLES)
        mel = pad_or_trim(mel, N_FRAMES, axis=-2).astype(self.mx.float16)
        words = find_alignment(self.model, self.tokenizer, encoded, mel, round(analysis_seconds * 100))
        merge_punctuations(words, "\"'“¿([{-", "\"'.。,，!！?？:：”)]}、")
        scale = duration / analysis_seconds
        return {"analysis_seconds": analysis_seconds, "analysis_speed": speed,
                "words": [{"word": w.word, "start": float(w.start) * scale, "end": float(w.end) * scale,
                           "probability": float(w.probability)} for w in words if w.word.strip()]}


def aligned_rows(rows, group, placement, words, duration):
    """Exact text identity, no fuzzy substitution; reject bad local alignments."""
    result = copy.deepcopy(rows)
    expected = [t for row in result for t in tokens(row["french"])]
    recognized, bounds = [], []
    previous = 0
    for word in words:
        a, b = word["start"], word["end"]
        if not math.isfinite(a) or not math.isfinite(b) or not 0 <= a <= b <= duration + .1 or a < previous - .001:
            raise CLIError("Repères d'alignement locaux invalides.")
        previous = a
        ts = tokens(word["word"])
        recognized.extend(ts)
        bounds.extend([(round(a * 1000), round(b * 1000))] * len(ts))
    if recognized != expected:
        raise CLIError("Le texte aligné ne correspond pas exactement au texte du projet.")
    origin, slot_end = voice_slot(placement)
    cursor = 0
    for row in result:
        count = len(tokens(row["french"]))
        if not count:
            raise CLIError("Sous-titre sans mot alignable.")
        a, b = bounds[cursor][0], bounds[cursor + count - 1][1]
        if b <= a:
            raise CLIError("Sous-titre sans durée fiable : vérifier cette prise.")
        row.update(start_ms=origin + a, end_ms=min(slot_end, origin + b))
        cursor += count
    if any(r["end_ms"] <= r["start_ms"] for r in result) or any(a["end_ms"] > b["start_ms"] for a, b in zip(result, result[1:])):
        raise CLIError("Sous-titres alignés chevauchants/non positifs : vérifier cette prise.")
    return result


def readable_ends(rows, groups, mapped, speech=None):
    """Keep accurate onsets; avoid a blank flash during very short pauses."""
    result = copy.deepcopy(rows)
    by_id = {r["id"]: r for r in result}
    for group_index, (group, placement) in enumerate(zip(groups, mapped)):
        selected = [by_id[sid] for sid in group.ids]
        origin, limit = voice_slot(placement)
        for index, row in enumerate(selected):
            word_end = row["end_ms"]
            next_start = selected[index + 1]["start_ms"] if index + 1 < len(selected) else limit
            gap = next_start - row["end_ms"]
            if index + 1 < len(selected) and 0 <= gap <= 300:
                row["end_ms"] = next_start
            else:
                row["end_ms"] = min(limit, next_start, row["end_ms"] + 120)
            if speech is not None:
                planned_end = row["end_ms"]
                for a, b in speech[group_index]:
                    a, b = origin + a, origin + b
                    if a <= planned_end + 80 and b >= word_end - 80 and b > word_end:
                        # A real spoken tail, not a guessed duration. Never
                        # cross the next caption or the independent take fence.
                        row["end_ms"] = max(row["end_ms"], min(b + 60, word_end + 700, next_start, limit))
    return result


def speech_coverage(rows, groups, mapped, speech, seconds):
    """Audio-only QA: voiced bursts without a displayed French caption."""
    uncovered, voiced = [], 0
    for placement, regions in zip(mapped, speech):
        origin, _ = voice_slot(placement)
        for x, y in regions:
            a, b = origin + x, min(round(seconds * 1000), origin + y)
            if b <= a:
                continue
            voiced += b - a
            cursor = a
            for row in rows:
                if row["end_ms"] <= cursor:
                    continue
                if row["start_ms"] >= b:
                    break
                if row["start_ms"] > cursor:
                    uncovered.append((cursor, min(b, row["start_ms"])))
                cursor = max(cursor, min(b, row["end_ms"]))
                if cursor >= b:
                    break
            if cursor < b:
                uncovered.append((cursor, b))
    durations = [b - a for a, b in uncovered]
    return {"voiced_ms": voiced, "uncovered_ms": sum(durations),
            "uncovered_fraction": sum(durations) / max(1, voiced), "bursts_over200ms": sum(x > 200 for x in durations),
            "max_uncovered_ms": max(durations, default=0), "uncovered_regions": uncovered}


def align_export(export, project, audit, output, seconds=900, model_name="base", prepare_preview=False):
    if output.resolve() == export.resolve() or (output.exists() and not (output / "identity.json").is_file()):
        raise CLIError("Choisir un nouveau dossier d'alignement, distinct de l'export source.")
    output.mkdir(parents=True, exist_ok=True)
    with locked(output):
        return _align_export(export, project, audit, output, seconds, model_name, prepare_preview)


def _align_export(export, project, audit, output, seconds, model_name, prepare_preview):
    timing = read_json(export / "timing.json")
    raw = Path(timing["source_export"])
    plan = read_json(raw / "plan.json")
    if file_hash(raw / "plan.json") != timing["source_plan_sha256"]:
        raise CLIError("Le plan brut diffère du plan utilisé pour recaler la vidéo.")
    if file_hash(export / "voice.wav") != read_json(audit / "identity.json")["voice_sha256"]:
        raise CLIError("La référence STT ne correspond pas à cette piste française.")
    count = sum(p["start_ms"] < seconds * 1000 for p in timing["paragraphs"])
    groups = [Paragraph(**p) for p in plan["paragraphs"][:count]]
    mapped = [Paragraph(**p) for p in timing["paragraphs"][:count]]
    source = load_project(project, translated=True)
    baseline = remap_segments(source, groups, timing["pieces"])
    natural = []
    for i in range(count):
        with wave.open(str(raw / f"{i:04d}-raw.wav")) as wav:
            natural.append(wav.getnframes() / wav.getframerate())
    vad = read_json(export / "speech-mix.json")["french_speech_regions"][:count]
    linear, _ = voice_timed_segments(baseline, groups, mapped, natural, vad)
    by_id = {r["id"]: r for r in linear}
    aligner = None
    if model_name == "ctc-fr":
        from ctc_alignment import FrenchCTCAligner
        aligner = FrenchCTCAligner()
        model_path, model_hashes = aligner.path, aligner.model_hashes
    else:
        model_path, model_hashes = model_files(model_name)
    identity = {"source_plan_sha256": file_hash(raw / "plan.json"), "timing_sha256": file_hash(export / "timing.json"),
                "model": "VOXPOPULI_ASR_BASE_10K_FR" if model_name == "ctc-fr" else f"mlx-community/whisper-{model_name}-mlx",
                "model_heads": HEADS[model_name].decode() if model_name in HEADS else "ctc-french-graphemes", "seconds": seconds,
                "model_revision": model_path.name, "model_files_sha256": model_hashes,
                "provider_sha256": file_hash(Path(__file__).with_name("ctc_alignment.py")) if model_name == "ctc-fr" else None,
                "display": {"short_pause_fill_ms": 300, "end_hold_ms": 120, "onsets_unchanged": True,
                            "speech_tail_pad_ms": 60, "speech_tail_cap_ms": 700},
                "script_sha256": file_hash(Path(__file__)),
                "package_versions": {name: importlib.metadata.version(name) for name in
                                     (("torch", "torchaudio") if model_name == "ctc-fr" else ("mlx-whisper",))}}
    if (output / "identity.json").exists() and read_json(output / "identity.json") != identity:
        raise CLIError("Cache d'alignement différent : nouveau dossier requis.")
    write_json(output / "identity.json", identity)
    shutil.copyfile(__file__, output / "alignment-engine.py")
    if model_name == "ctc-fr":
        shutil.copyfile(Path(__file__).with_name("ctc_alignment.py"), output / "ctc-engine.py")
    aligned = []
    elapsed = time.monotonic()
    for i, (group, placement, duration) in enumerate(zip(groups, mapped, natural)):
        audio = raw / f"{i:04d}-raw.wav"
        digest = file_hash(audio)
        if digest != read_json(raw / f"{i:04d}.json")["raw_sha256"]:
            raise CLIError("Prise brute modifiée.")
        cache = output / f"aligned-{i:04d}.json"
        if cache.exists():
            result = read_json(cache)
            if result["raw_sha256"] != digest:
                raise CLIError("Cache d'alignement d'une autre prise.")
        else:
            if aligner is None:
                aligner = WhisperAligner(model_name, model_path)
            print(f"Alignement local {i + 1}/{count}", flush=True)
            result = aligner.align(audio, group.text, output / f"analysis-{i:04d}.wav", duration)
            result["raw_sha256"] = digest
            write_json(cache, result)
        aligned.extend(aligned_rows([by_id[sid] for sid in group.ids], group, placement, result["words"], duration))
    write_json(output / "word-aligned-segments.json", aligned)
    exact = aligned
    from subtitle_audio import energy_regions
    energy = [energy_regions(raw / f"{i:04d}-raw.wav") for i in range(count)]
    aligned = readable_ends(exact, groups, mapped, energy)
    write_json(output / "aligned-segments.json", aligned)
    binary = ROOT / "web/.cache/local-api"
    import subprocess
    response = subprocess.run([str(binary)], input=json.dumps({"kind": "subtitles", "segments": aligned,
        "width": plan["media"]["width"], "height": plan["media"]["height"]}), text=True, capture_output=True, timeout=60)
    response_data = json.loads(response.stdout)
    if response.returncode or response_data.get("error"):
        raise CLIError("Échec du rendu des sous-titres alignés.")
    for key, filename in (("ass", "subtitles.ass"), ("srt", "subtitles.srt")):
        atomic_write(output / filename, response_data["result"][key].encode())
    words = read_json(audit / "groq-response.json")["words"]
    report = {"identity": identity, "seconds_elapsed": time.monotonic() - elapsed,
              "reference_scope_seconds": 600, "reference_is_approximate_not_ground_truth": True,
              "word_aligned": compare(exact, words, 600),
              "audio_coverage": speech_coverage(aligned, groups, mapped, energy, seconds),
              "linear": compare(linear, words, 600), "aligned": compare(aligned, words, 600),
              "rendered_srt": compare(read_srt(output / "subtitles.srt"), words, 600)}
    write_json(output / "report.json", report)
    if prepare_preview:
        inputs = {}
        for name in ("retimed-source.mkv", "voice.wav", "mix.ffscript"):
            source_file = (export / name).resolve(strict=True)
            destination = output / name
            if destination.exists():
                if destination.resolve() != source_file:
                    raise CLIError("Un autre fichier d'aperçu existe déjà.")
            else:
                destination.symlink_to(source_file)
            inputs[name] = file_hash(source_file)
        write_json(output / "preview-inputs.json", inputs)
        preview_timing = copy.deepcopy(timing)
        preview_timing.update(subtitle_timing="whisper-known-text", source_timing_sha256=identity["timing_sha256"])
        write_json(output / "timing.json", preview_timing)
    print(json.dumps({k: report[k]["summary"] for k in ("linear", "aligned", "rendered_srt")}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("export", "project", "audit", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--seconds", type=float, default=900)
    parser.add_argument("--model", choices=["base", "small", "ctc-fr"], default="base")
    parser.add_argument("--prepare-preview", action="store_true", help="Références locales aux images/voix/mix existants ; aucun rendu complet")
    args = parser.parse_args()
    try:
        if not math.isfinite(args.seconds) or not 1 <= args.seconds <= 900:
            raise CLIError("Essai limité à 1–900 secondes de sortie.")
        align_export(args.export.resolve(), args.project, args.audit, args.output.resolve(), args.seconds, args.model, args.prepare_preview)
    except (CLIError, OSError, ValueError, KeyError, ImportError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1)
