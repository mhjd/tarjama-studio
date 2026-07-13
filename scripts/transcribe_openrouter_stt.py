#!/usr/bin/env python3
import argparse
import base64
import json
import os
import time
from pathlib import Path

import requests


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="data/manifests/dedew_manifest.jsonl")
    parser.add_argument("--model", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--only", required=True)
    parser.add_argument("--output-id", default=None)
    parser.add_argument("--audio-path", default=None)
    parser.add_argument("--language", default="ar")
    parser.add_argument("--temperature", type=float, default=0.0)
    args = parser.parse_args()

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise SystemExit("OPENROUTER_API_KEY is not set")

    rows = load_manifest(Path(args.manifest))
    matches = [row for row in rows if row["corpus_id"] == args.only]
    if not matches:
        raise SystemExit(f"No corpus_id found: {args.only}")
    row = matches[0]

    audio_path = Path(args.audio_path) if args.audio_path else Path(row["audio_path"])
    audio_b64 = base64.b64encode(audio_path.read_bytes()).decode("ascii")
    payload = {
        "model": args.model,
        "language": args.language,
        "temperature": args.temperature,
        "input_audio": {
            "data": audio_b64,
            "format": audio_path.suffix.lstrip("."),
        },
    }

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    started = time.time()
    print(f"[openrouter] {args.model} -> {row['corpus_id']} ({audio_path})", flush=True)
    response = requests.post(
        "https://openrouter.ai/api/v1/audio/transcriptions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://localhost/tarjama-studio",
            "X-Title": "tarjama-studio-arabic-asr-benchmark",
        },
        json=payload,
        timeout=600,
    )
    elapsed = time.time() - started

    try:
        body = response.json()
    except Exception:
        body = {"raw_response": response.text}

    result = {
        "corpus_id": row["corpus_id"],
        "model": args.model,
        "engine": "openrouter-stt",
        "status_code": response.status_code,
        "audio_path": str(audio_path),
        "youtube_url": row.get("youtube_url"),
        "duration_seconds": row.get("duration_seconds"),
        "elapsed_seconds": elapsed,
        "response": body,
    }

    output_id = args.output_id or row["corpus_id"]
    base = output_dir / output_id
    write_json(base.with_suffix(".json"), result)
    text = body.get("text", "") if isinstance(body, dict) else ""
    if text:
        base.with_suffix(".txt").write_text(text.strip() + "\n", encoding="utf-8")

    summary = {
        "corpus_id": row["corpus_id"],
        "output_id": output_id,
        "model": args.model,
        "status_code": response.status_code,
        "elapsed_seconds": elapsed,
        "usage": body.get("usage") if isinstance(body, dict) else None,
        "text_chars": len(text),
    }
    with (output_dir / "summary.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(summary, ensure_ascii=False) + "\n")

    print(json.dumps(summary, ensure_ascii=False), flush=True)
    if response.status_code >= 400:
        raise SystemExit(f"OpenRouter request failed: HTTP {response.status_code}")


if __name__ == "__main__":
    main()
