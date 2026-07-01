#!/usr/bin/env python3
import argparse
import json
import time
from pathlib import Path

import torch
import soundfile as sf
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline


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
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    return {"array": audio, "sampling_rate": sample_rate}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="data/manifests/dedew_manifest.jsonl")
    parser.add_argument("--model", required=True)
    parser.add_argument("--processor", default=None)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--only", nargs="*", default=None)
    parser.add_argument("--language", default="arabic")
    parser.add_argument("--task", default="transcribe")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--chunk-length-s", type=int, default=30)
    parser.add_argument("--dtype", choices=["float16", "float32"], default="float16")
    args = parser.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    torch_dtype = torch.float16 if args.dtype == "float16" else torch.float32
    if device == "cpu":
        torch_dtype = torch.float32

    processor_id = args.processor or args.model
    print(f"[load] model={args.model} processor={processor_id} device={device} dtype={torch_dtype}", flush=True)
    processor = AutoProcessor.from_pretrained(processor_id)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        args.model,
        torch_dtype=torch_dtype,
        low_cpu_mem_usage=True,
        use_safetensors=True,
    )
    model.to(device)

    asr = pipeline(
        "automatic-speech-recognition",
        model=model,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        device=device,
        torch_dtype=torch_dtype,
        chunk_length_s=args.chunk_length_s,
        batch_size=args.batch_size,
        return_timestamps=True,
    )

    manifest = load_manifest(Path(args.manifest))
    if args.only:
        wanted = set(args.only)
        manifest = [row for row in manifest if row["corpus_id"] in wanted]
    if args.limit:
        manifest = manifest[: args.limit]

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = output_dir / "summary.jsonl"

    generate_kwargs = {"language": args.language, "task": args.task}
    with summary_path.open("a", encoding="utf-8") as summary:
        for row in manifest:
            corpus_id = row["corpus_id"]
            audio_path = row["audio_path"]
            started = time.time()
            print(f"[transformers] {args.model} -> {corpus_id} ({audio_path})", flush=True)

            result = asr(load_audio_array(Path(audio_path)), generate_kwargs=generate_kwargs)
            elapsed = time.time() - started
            text = result.get("text", "").strip()
            payload = {
                "corpus_id": corpus_id,
                "model": args.model,
                "processor": processor_id,
                "engine": "transformers",
                "device": device,
                "dtype": str(torch_dtype),
                "audio_path": audio_path,
                "youtube_url": row.get("youtube_url"),
                "duration_seconds": row.get("duration_seconds"),
                "elapsed_seconds": elapsed,
                "text": text,
                "chunks": result.get("chunks", []),
            }

            base = output_dir / corpus_id
            (base.with_suffix(".txt")).write_text(text + "\n", encoding="utf-8")
            write_json(base.with_suffix(".json"), payload)
            summary.write(json.dumps({k: payload[k] for k in payload if k != "chunks" and k != "text"}, ensure_ascii=False) + "\n")
            summary.flush()
            print(f"[done] {corpus_id}: {elapsed:.1f}s, {len(text)} chars", flush=True)


if __name__ == "__main__":
    main()
