"""Measure a real MLX batch against saved single-take timings, no text output."""
import argparse
from pathlib import Path
import time
import wave

from qwen_voice import QwenVoice
from tts_export import file_hash
from workspace import CLIError, read_json, write_json


def benchmark(source, reference, output, start=6, count=4):
    plan = read_json(source / "plan.json")
    if file_hash(reference) != plan["reference_sha256"]:
        raise CLIError("La référence a changé.")
    indices = list(range(start, start + count))
    baseline = 0
    for index in indices:
        marker = read_json(source / f"{index:04d}.json")
        if file_hash(source / f"{index:04d}-raw.wav") != marker["raw_sha256"]:
            raise CLIError("Prise de comparaison modifiée.")
        baseline += marker["generation_seconds"]
    output.mkdir(parents=True, exist_ok=False)
    voice = QwenVoice(plan["backend"], plan["model"], "Ryan", reference, plan["max_tokens"],
                      reference_text=plan["reference_text"], sampling=plan["sampling"])
    import mlx.core as mx
    seed = plan["seed_per_paragraph"][start]
    mx.random.seed(seed)
    files = [output / f"{i:04d}-batch.wav" for i in indices]
    started = time.monotonic()
    voice.generate_batch([plan["paragraphs"][i]["text"] for i in indices], files)
    elapsed = time.monotonic() - started
    durations = []
    for target in files:
        with wave.open(str(target)) as wav:
            durations.append(wav.getnframes() / wav.getframerate())
    result = {"indices": indices, "seed_shared_by_batch": seed, "batch_seconds": elapsed,
              "saved_sequential_seconds": baseline, "measured_speedup": baseline / elapsed,
              "durations_seconds": durations, "peak_mlx_memory_bytes": mx.get_peak_memory(),
              "sampling": plan["sampling"], "source_plan_sha256": file_hash(source / "plan.json"),
              "raw_sha256": [file_hash(f) for f in files],
              "note": "RNG shared by batch, not bit-identical to independent single-take seeds; quality not independently listened to"}
    write_json(output / "benchmark.json", result)
    print(f"Lot {count} : {elapsed:.1f} s ; séquentiel enregistré : {baseline:.1f} s ; gain mesuré {baseline / elapsed:.2f}×")
    print(f"Mémoire MLX maximale : {mx.get_peak_memory() / 1024**3:.2f} Gio")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    benchmark(args.source, args.reference, args.output)
