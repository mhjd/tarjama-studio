"""Controlled temperature-only Qwen comparison, using the same French paragraphs."""
import argparse
from pathlib import Path
import sys
import time

from pocket_sample import natural_audio
from qwen_voice import QwenVoice, settings
from tts_export import file_hash
from workspace import CLIError, read_json, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", dest="source", type=Path, required=True)
    parser.add_argument("--reference-audio", type=Path, required=True)
    parser.add_argument("--reference-text", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise CLIError("Le dossier existe déjà : choisir un nouveau dossier.")
    source_plan = read_json(args.source / "plan.json")
    groups = source_plan["paragraphs"][:2]
    if len(groups) != 2:
        raise CLIError("Deux paragraphes sont nécessaires.")
    transcript = args.reference_text.read_text(encoding="utf-8").strip()
    if not transcript:
        raise CLIError("La transcription de référence est vide.")
    backend, model = settings("mlx", None, True)
    args.output.mkdir(parents=True)
    write_json(args.output / "plan.json", {"model": model, "backend": backend,
               "source_plan_sha256": file_hash(args.source / "plan.json"), "paragraphs": groups,
               "reference_audio_sha256": file_hash(args.reference_audio), "reference_text": transcript,
               "temperatures": [.9, .6, .35], "top_k": 50, "top_p": 1.0,
               "requested_repetition_penalty": 1.05, "effective_mlx_icl_repetition_penalty": 1.5,
               "seed_per_paragraph": [20261017, 20261018], "french_speed": 1, "max_tokens": 2048})
    voice = QwenVoice(backend, model, "Ryan", args.reference_audio.resolve(), 2048, reference_text=transcript)
    import mlx.core as mx
    results = []
    for temperature in (.9, .6, .35):
        folder = args.output / f"temperature-{temperature:g}"
        folder.mkdir()
        voice.sampling = {"temperature": temperature, "top_k": 50, "top_p": 1.0, "repetition_penalty": 1.05}
        start = time.monotonic()
        for index, group in enumerate(groups):
            print(f"Qwen température {temperature:g} — paragraphe {index + 1}/2", flush=True)
            mx.random.seed(20261017 + index)
            voice.generate(group["text"], folder / f"{index:04d}-raw.wav")
        audio = natural_audio(folder, 2)
        results.append({"temperature": temperature, "generation_seconds": time.monotonic() - start,
                        "output": str(audio), "sha256": file_hash(audio)})
        write_json(args.output / "results.json", results)
    # The already approved candidate, without regenerating or stretching it.
    import shutil
    witness = args.output / "pocket-witness"
    witness.mkdir()
    for index in range(2):
        source = args.source / f"{index:04d}-raw.wav"
        if file_hash(source) != read_json(args.source / f"{index:04d}.json")["raw_sha256"]:
            raise CLIError("La prise Pocket a changé.")
        shutil.copyfile(source, witness / source.name)
    natural_audio(witness, 2)
    print(f"Comparaison prête : {args.output}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (CLIError, OSError, ValueError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1)
