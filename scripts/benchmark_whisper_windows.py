#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "data/model_outputs/whisper_windows_benchmark"
DEFAULT_MODELS = [
    "openai/whisper-tiny",
    "openai/whisper-base",
    "openai/whisper-small",
    "openai/whisper-medium",
    "openai/whisper-large-v3-turbo",
    "openai/whisper-large-v3",
]


def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def resolve_ffmpeg(explicit: str | None = None) -> str:
    candidates: list[str | None] = [explicit, shutil.which("ffmpeg")]
    if os.name == "nt":
        candidates.extend(
            [
                str(ROOT / "ui/desktop-bin/win32-x64/ffmpeg.exe"),
                str(ROOT / "ui/release/win-unpacked/resources/desktop-bin/win32-x64/ffmpeg.exe"),
            ]
        )
    elif platform.system() == "Darwin":
        candidates.extend(
            [
                str(ROOT / "ui/desktop-bin/darwin-arm64/ffmpeg"),
                str(ROOT / "ui/release/win-unpacked/resources/desktop-bin/darwin-arm64/ffmpeg"),
            ]
        )
    try:
        import imageio_ffmpeg  # type: ignore

        candidates.append(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        pass

    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if path.exists() and os.name != "nt" and not os.access(path, os.X_OK):
            continue
        if path.exists() or shutil.which(candidate):
            try:
                result = subprocess.run(
                    [candidate, "-version"],
                    cwd=ROOT,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            except OSError:
                continue
            if result.returncode == 0:
                return candidate
    raise SystemExit("ffmpeg is not available. Install ffmpeg or run the desktop tools preparation first.")


def make_sample(ffmpeg: str, source: Path, target: Path, seconds: int) -> float:
    target.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-t",
        str(seconds),
        "-ac",
        "1",
        "-ar",
        "16000",
        str(target),
    ]
    result = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        raise SystemExit(f"Could not create benchmark sample with ffmpeg:\n{result.stderr.strip()}")

    with wave.open(str(target), "rb") as handle:
        frames = handle.getnframes()
        rate = handle.getframerate()
    if rate <= 0:
        raise SystemExit("Invalid sample rate in generated WAV")
    return frames / rate


def kill_process_tree(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        process.kill()


def run_one_model(
    model: str,
    sample_path: Path,
    run_dir: Path,
    timeout_seconds: int,
    language: str,
    task: str,
    batch_size: int,
    chunk_length_s: int,
) -> dict[str, Any]:
    safe_name = (
        model.replace("/", "__")
        .replace("\\", "__")
        .replace(":", "_")
        .replace(" ", "_")
    )
    model_dir = run_dir / safe_name
    model_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = model_dir / "stdout.txt"
    stderr_path = model_dir / "stderr.txt"
    result_path = model_dir / "result.json"

    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "_run-one",
        "--model",
        model,
        "--sample",
        str(sample_path),
        "--output",
        str(result_path),
        "--language",
        language,
        "--task",
        task,
        "--batch-size",
        str(batch_size),
        "--chunk-length-s",
        str(chunk_length_s),
    ]

    started = time.monotonic()
    with stdout_path.open("w", encoding="utf-8") as stdout, stderr_path.open("w", encoding="utf-8") as stderr:
        process = subprocess.Popen(
            command,
            cwd=ROOT,
            text=True,
            stdout=stdout,
            stderr=stderr,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        )
        try:
            returncode = process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            kill_process_tree(process)
            elapsed = time.monotonic() - started
            return {
                "model": model,
                "status": "timeout",
                "elapsed_seconds": elapsed,
                "timeout_seconds": timeout_seconds,
                "stdout_path": str(stdout_path),
                "stderr_path": str(stderr_path),
                "result_path": str(result_path),
            }

    elapsed = time.monotonic() - started
    if returncode != 0:
        stderr_tail = ""
        if stderr_path.exists():
            stderr_tail = stderr_path.read_text(encoding="utf-8", errors="replace")[-4000:]
        return {
            "model": model,
            "status": "failed",
            "returncode": returncode,
            "elapsed_seconds": elapsed,
            "stdout_path": str(stdout_path),
            "stderr_path": str(stderr_path),
            "stderr_tail": stderr_tail,
            "result_path": str(result_path),
        }

    if not result_path.exists():
        return {
            "model": model,
            "status": "failed",
            "returncode": returncode,
            "elapsed_seconds": elapsed,
            "stdout_path": str(stdout_path),
            "stderr_path": str(stderr_path),
            "stderr_tail": "Child process completed without writing result.json",
            "result_path": str(result_path),
        }

    payload = json.loads(result_path.read_text(encoding="utf-8"))
    payload.update(
        {
            "model": model,
            "status": "ok",
            "elapsed_seconds": elapsed,
            "stdout_path": str(stdout_path),
            "stderr_path": str(stderr_path),
            "result_path": str(result_path),
        }
    )
    return payload


def print_summary(results: list[dict[str, Any]], sample_seconds: float) -> None:
    print("")
    print("Model benchmark")
    print("---------------")
    print(f"Sample duration: {sample_seconds:.1f}s")
    print("")
    print(f"{'status':<9} {'elapsed':>9} {'rtf':>7}  model")
    for item in results:
        elapsed = float(item.get("elapsed_seconds") or 0)
        rtf = elapsed / sample_seconds if sample_seconds > 0 else 0
        print(f"{item['status']:<9} {elapsed:>8.1f}s {rtf:>6.2f}x  {item['model']}")

    ok = [item for item in results if item.get("status") == "ok"]
    if not ok:
        print("")
        print("Recommendation: none. No model completed successfully.")
        return

    recommended = ok[-1]
    fastest = min(ok, key=lambda item: float(item.get("elapsed_seconds") or 10**9))
    print("")
    print(f"Recommendation: {recommended['model']} (largest model that completed before timeout)")
    if fastest["model"] != recommended["model"]:
        print(f"Fastest completed model: {fastest['model']}")


def parent_main(args: argparse.Namespace) -> None:
    source = Path(args.input).expanduser().resolve()
    if not source.exists():
        raise SystemExit(f"Input file does not exist: {source}")

    ffmpeg = resolve_ffmpeg(args.ffmpeg)
    run_dir = Path(args.output_dir).expanduser().resolve() / now_stamp()
    sample_path = run_dir / f"sample_{args.sample_seconds}s.wav"
    sample_duration = make_sample(ffmpeg, source, sample_path, args.sample_seconds)

    results: list[dict[str, Any]] = []
    metadata = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input": str(source),
        "sample_path": str(sample_path),
        "sample_duration_seconds": sample_duration,
        "timeout_seconds": args.timeout_seconds,
        "models": args.models,
        "stop_after_failure": not args.continue_after_failure,
        "ffmpeg": ffmpeg,
        "python": sys.executable,
    }
    write_json(run_dir / "metadata.json", metadata)

    print(f"[sample] {sample_path}")
    for model in args.models:
        print(f"[benchmark] {model}", flush=True)
        result = run_one_model(
            model=model,
            sample_path=sample_path,
            run_dir=run_dir,
            timeout_seconds=args.timeout_seconds,
            language=args.language,
            task=args.task,
            batch_size=args.batch_size,
            chunk_length_s=args.chunk_length_s,
        )
        result["realtime_factor"] = (
            float(result.get("elapsed_seconds") or 0) / sample_duration if sample_duration > 0 else None
        )
        results.append(result)
        write_json(run_dir / "summary.json", {"metadata": metadata, "results": results})

        if result["status"] != "ok" and not args.continue_after_failure:
            print(f"[stop] {model} ended with status={result['status']}; not trying larger models.")
            break

    print_summary(results, sample_duration)
    print("")
    print(f"Full report: {run_dir / 'summary.json'}")


def child_main(args: argparse.Namespace) -> None:
    import torch
    import soundfile as sf
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

    sample_path = Path(args.sample)
    audio, sample_rate = sf.read(str(sample_path), dtype="float32")
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)

    if torch.cuda.is_available():
        device = "cuda:0"
        torch_dtype = torch.float16
        pipeline_device = 0
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        device = "mps"
        torch_dtype = torch.float16
        pipeline_device = "mps"
    else:
        device = "cpu"
        torch_dtype = torch.float32
        pipeline_device = -1

    batch_size = args.batch_size
    if batch_size <= 0:
        batch_size = 8 if device.startswith("cuda") else 1

    started = time.monotonic()
    print(f"[load] model={args.model} device={device} dtype={torch_dtype} batch={batch_size}", flush=True)
    processor = AutoProcessor.from_pretrained(args.model)
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
        device=pipeline_device,
        torch_dtype=torch_dtype,
        chunk_length_s=args.chunk_length_s,
        batch_size=batch_size,
        return_timestamps=True,
    )
    loaded_at = time.monotonic()
    result = asr({"array": audio, "sampling_rate": sample_rate}, generate_kwargs={"language": args.language, "task": args.task})
    finished_at = time.monotonic()

    text = str(result.get("text", "")).strip()
    write_json(
        Path(args.output),
        {
            "model": args.model,
            "engine": "transformers",
            "device": device,
            "dtype": str(torch_dtype),
            "batch_size": batch_size,
            "chunk_length_s": args.chunk_length_s,
            "language": args.language,
            "task": args.task,
            "load_seconds": loaded_at - started,
            "transcribe_seconds": finished_at - loaded_at,
            "elapsed_seconds": finished_at - started,
            "text_chars": len(text),
            "text_preview": text[:1000],
            "chunks_count": len(result.get("chunks", [])),
        },
    )
    print(f"[done] chars={len(text)} elapsed={finished_at - started:.1f}s", flush=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Benchmark Whisper model sizes on a Windows machine using a 2-minute sample.",
    )
    sub = parser.add_subparsers(dest="command")

    run = sub.add_parser("run", help="Run the benchmark")
    run.add_argument("--input", required=True, help="Path to a video or audio file")
    run.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    run.add_argument("--ffmpeg", default=None, help="Optional explicit ffmpeg executable path")
    run.add_argument("--sample-seconds", type=int, default=120)
    run.add_argument("--timeout-seconds", type=int, default=600)
    run.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    run.add_argument("--language", default="arabic")
    run.add_argument("--task", default="transcribe")
    run.add_argument("--batch-size", type=int, default=0, help="0 = auto; use 1 for safest low-memory run")
    run.add_argument("--chunk-length-s", type=int, default=30)
    run.add_argument(
        "--continue-after-failure",
        action="store_true",
        help="Try larger models even after a failure or timeout. Off by default to avoid stressing the machine.",
    )
    run.set_defaults(func=parent_main)

    child = sub.add_parser("_run-one")
    child.add_argument("--model", required=True)
    child.add_argument("--sample", required=True)
    child.add_argument("--output", required=True)
    child.add_argument("--language", default="arabic")
    child.add_argument("--task", default="transcribe")
    child.add_argument("--batch-size", type=int, default=0)
    child.add_argument("--chunk-length-s", type=int, default=30)
    child.set_defaults(func=child_main)
    return parser


def main() -> None:
    parser = build_parser()
    argv = sys.argv[1:]
    if not argv or argv[0] not in {"run", "_run-one", "-h", "--help"}:
        argv = ["run", *argv]
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
