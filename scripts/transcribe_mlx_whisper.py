#!/usr/bin/env python3
import argparse
import json
import time
from pathlib import Path

import soundfile as sf


DEFAULT_MODEL = "mlx-community/whisper-large-v3-mlx"


def safe_model_name(model_id: str) -> str:
    return (
        model_id.replace("/", "__")
        .replace(":", "_")
        .replace("@", "_")
        .replace("-", "_")
    )


def load_manifest(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_audio_array(path: Path):
    audio, sample_rate = sf.read(str(path), dtype="float32")
    if sample_rate != 16000:
        raise ValueError(f"{path} has sample_rate={sample_rate}; expected 16000 Hz")
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    return audio


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="data/manifests/dedew_manifest.jsonl")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--only", nargs="*", default=None)
    parser.add_argument("--language", default="ar")
    parser.add_argument("--task", default="transcribe")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    manifest = load_manifest(Path(args.manifest))
    if args.only:
        wanted = set(args.only)
        manifest = [row for row in manifest if row["corpus_id"] in wanted]
    if args.limit:
        manifest = manifest[: args.limit]
    if not manifest:
        print("[skip] no matching corpus entries", flush=True)
        return

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = output_dir / "summary.jsonl"

    import mlx_whisper

    with summary_path.open("a", encoding="utf-8") as summary:
        for row in manifest:
            corpus_id = row["corpus_id"]
            audio_path = Path(row["audio_path"])
            started = time.time()
            print(f"[mlx] {args.model} -> {corpus_id} ({audio_path})", flush=True)

            audio = load_audio_array(audio_path)
            result = mlx_whisper.transcribe(
                audio,
                path_or_hf_repo=args.model,
                language=args.language,
                task=args.task,
                verbose=args.verbose,
                word_timestamps=False,
                condition_on_previous_text=True,
            )
            elapsed = time.time() - started

            text = result.get("text", "").strip()
            payload = {
                "corpus_id": corpus_id,
                "model": args.model,
                "engine": "mlx-whisper",
                "audio_path": str(audio_path),
                "youtube_url": row.get("youtube_url"),
                "duration_seconds": row.get("duration_seconds"),
                "elapsed_seconds": elapsed,
                "text": text,
                "segments": result.get("segments", []),
                "language": result.get("language"),
            }

            base = output_dir / corpus_id
            (base.with_suffix(".txt")).write_text(text + "\n", encoding="utf-8")
            write_json(base.with_suffix(".json"), payload)
            summary.write(json.dumps({k: payload[k] for k in payload if k != "segments" and k != "text"}, ensure_ascii=False) + "\n")
            summary.flush()
            print(f"[done] {corpus_id}: {elapsed:.1f}s, {len(text)} chars", flush=True)


if __name__ == "__main__":
    main()
