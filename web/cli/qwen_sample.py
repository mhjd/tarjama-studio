"""A new, explicitly sampled Qwen take, then natural-voice video retiming."""
import argparse
from dataclasses import asdict
import math
import shutil
from pathlib import Path
import sys
import time

from pocket_sample import natural_audio
from qwen_voice import QwenVoice, settings
from retime_video import limit_source, retime
from tts_export import Paragraph, file_hash
from workspace import CLIError, locked, read_json, write_json


def sample_plan(source, reference, transcript, temperature, seconds, seed, *, voice_description=None, repetition_penalty=1.05):
    if not math.isfinite(temperature) or not 0 <= temperature <= 2:
        raise CLIError("La température doit être comprise entre 0 et 2.")
    if not math.isfinite(repetition_penalty) or repetition_penalty <= 0:
        raise CLIError("La pénalité de répétition doit être positive et finie.")
    if voice_description is not None and (reference is not None or transcript or not voice_description.strip()):
        raise CLIError("VoiceDesign exige une description non vide, sans référence audio/texte.")
    if voice_description is None and (reference is None or not transcript.strip()):
        raise CLIError("Transcription de référence vide.")
    original = read_json(source / "plan.json")
    groups, source_end = limit_source([Paragraph(**p) for p in original["paragraphs"]],
                                      original["media"]["duration_ms"], seconds)
    if file_hash(Path(original["video"])) != original["video_sha256"]:
        raise CLIError("La vidéo source a changé.")
    design = voice_description is not None
    backend, model = settings("mlx", None, not design, voice_design=design)
    plan = {"format": "tarjama-raw-tts-v1", "project_id": original["project_id"],
            "video": original["video"], "video_sha256": original["video_sha256"], "media": original["media"],
            "source_plan_sha256": file_hash(source / "plan.json"), "source_export": str(source.resolve()),
            "paragraphs": [asdict(p) for p in groups], "requested_source_seconds": seconds,
            "source_end_ms": source_end, "backend": backend, "model": model, "language": "French",
            "reference_sha256": file_hash(reference) if reference else None, "reference_text": transcript.strip() if transcript else None,
            "sampling": {"temperature": temperature, "top_p": 1.0, "top_k": 50, "repetition_penalty": repetition_penalty},
            "effective_mlx_icl_repetition_penalty": max(1.5, repetition_penalty), "seed_per_paragraph": [seed + i for i in range(len(groups))],
            "max_tokens": 2048, "french_speed": 1, "bed_db": original["bed_db"], "new_generation": True}
    if design:
        plan.update(voice_design=True, voice_description=voice_description.strip(),
                    effective_mlx_icl_repetition_penalty=None)
    return plan


def generate_raw(plan, directory, reference, *, resume=False, voice_factory=None, seed_func=None, batch_size=1, on_progress=None):
    if type(batch_size) is not int or not 1 <= batch_size <= 4:
        raise CLIError("La taille des lots doit être comprise entre 1 et 4.")
    if batch_size > 1 and (plan.get("backend") != "mlx" or not reference or not plan.get("reference_text") or plan.get("voice_design")):
        raise CLIError("Les lots exigent MLX avec audio et texte de référence.")
    exists = directory.exists()
    if exists and (not resume or not (directory / "plan.json").is_file() or read_json(directory / "plan.json") != plan):
        raise CLIError("Cache existant avec un autre plan : choisir un nouveau dossier.")
    directory.mkdir(parents=True, exist_ok=True)
    with locked(directory):
        write_json(directory / "plan.json", plan)
        voice, hashes, pending = None, [None] * len(plan["paragraphs"]), []
        for index, paragraph in enumerate(plan["paragraphs"]):
            raw, marker = directory / f"{index:04d}-raw.wav", directory / f"{index:04d}.json"
            if resume and raw.is_file() and marker.is_file() and read_json(marker).get("raw_sha256") == file_hash(raw):
                hashes[index] = file_hash(raw)
                continue
            pending.append(index)
        if on_progress:
            on_progress(sum(h is not None for h in hashes),len(hashes))
        for offset in range(0, len(pending), batch_size):
            indices = pending[offset:offset + batch_size]
            index = indices[0]
            if voice is None:
                style = {"description": plan["voice_description"]} if plan.get("voice_design") else {}
                voice = (voice_factory or QwenVoice)(plan["backend"], plan["model"], "Ryan", reference,
                        plan["max_tokens"], reference_text=plan["reference_text"], sampling=plan["sampling"], **style)
                if seed_func is None:
                    import mlx.core as mx
                    seed_func = mx.random.seed
            print(f"Prises Qwen {plan['sampling']['temperature']:g} — {index + 1}–{indices[-1] + 1}/{len(plan['paragraphs'])} (lot {len(indices)})", flush=True)
            seed_func(plan["seed_per_paragraph"][index])
            temporary = [directory / f"{i:04d}-generating.wav" for i in indices]
            start = time.monotonic()
            if len(indices) == 1:
                voice.generate(plan["paragraphs"][index]["text"], temporary[0])
            else:
                voice.generate_batch([plan["paragraphs"][i]["text"] for i in indices], temporary)
            elapsed = time.monotonic() - start
            for i, target in zip(indices, temporary):
                raw = directory / f"{i:04d}-raw.wav"
                target.replace(raw)
                digest = file_hash(raw)
                metadata = {"index": i, "raw_sha256": digest, "generation_seconds": elapsed / len(indices),
                            "seed": plan["seed_per_paragraph"][index], "temperature": plan["sampling"]["temperature"]}
                if len(indices) > 1:
                    metadata.update(generation_batch_indices=indices, generation_batch_seconds=elapsed,
                                    seed_scope="shared_batch_rng_not_independent_paragraph")
                write_json(directory / f"{i:04d}.json", metadata)
                hashes[i] = digest
            if on_progress:
                on_progress(sum(h is not None for h in hashes),len(hashes))
        natural_audio(directory, len(plan["paragraphs"]))
        write_json(directory / "raw-complete.json", {"format": "tarjama-raw-tts-complete-v1",
                   "plan_sha256": file_hash(directory / "plan.json"), "raw_sha256": hashes})


def reuse_raw_prefix(plan, directory, source):
    old = read_json(source / "plan.json")
    manifest = read_json(source / "raw-complete.json")
    if manifest["plan_sha256"] != file_hash(source / "plan.json"):
        raise CLIError("Le plan de l'essai à réutiliser a changé.")
    keys = ("video_sha256", "backend", "model", "reference_sha256", "reference_text", "sampling",
            "voice_design", "voice_description", "max_tokens", "effective_mlx_icl_repetition_penalty")
    count = len(old["paragraphs"])
    if any(old.get(k) != plan.get(k) for k in keys) or old["paragraphs"] != plan["paragraphs"][:count] or \
            old["seed_per_paragraph"] != plan["seed_per_paragraph"][:count]:
        raise CLIError("L'essai n'est pas un préfixe identique du nouveau plan.")
    for index in range(count):
        digest = file_hash(source / f"{index:04d}-raw.wav")
        if digest != manifest["raw_sha256"][index] or digest != read_json(source / f"{index:04d}.json")["raw_sha256"]:
            raise CLIError("Une prise à réutiliser a changé.")
    directory.mkdir(exist_ok=False)
    write_json(directory / "plan.json", plan)
    for index in range(count):
        for name in (f"{index:04d}-raw.wav", f"{index:04d}.json"):
            shutil.copyfile(source / name, directory / name)
    write_json(directory / "reuse.json", {"source": str(source), "source_plan_sha256": file_hash(source / "plan.json"),
               "count": count, "raw_sha256": manifest["raw_sha256"]})
    print(f"{count} prises identiques de l'essai réutilisées, sources conservées.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", dest="source", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--reference-audio", type=Path)
    mode.add_argument("--voice-design", action="store_true")
    parser.add_argument("--reference-text", type=Path)
    parser.add_argument("--voice-description-file", type=Path, help="Description VoiceDesign, sans clonage")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--temperature", type=float, required=True)
    parser.add_argument("--repetition-penalty", type=float, default=1.05)
    parser.add_argument("--seconds", type=float, default=300)
    parser.add_argument("--seed", type=int, default=20261017)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--batch-size", type=int, choices=[1, 2, 3, 4], default=1)
    parser.add_argument("--raw-only", action="store_true", help="Génère les prises seulement, pour un rendu documentaire séparé")
    parser.add_argument("--reuse-raw", type=Path, help="Réutilise un essai terminé strictement identique au début du nouveau plan")
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() and not args.resume:
        raise CLIError("La sortie existe déjà : nouveau dossier ou --resume.")
    if args.voice_design:
        if not args.voice_description_file or args.reference_text:
            raise CLIError("--voice-design exige --voice-description-file et interdit --reference-text.")
        description = args.voice_description_file.read_text(encoding="utf-8").strip()
    else:
        if not args.reference_text or args.voice_description_file:
            raise CLIError("Le clonage exige --reference-text, sans description VoiceDesign.")
        description = None
    transcript = args.reference_text.read_text(encoding="utf-8").strip() if args.reference_text else ""
    reference = args.reference_audio.resolve() if args.reference_audio else None
    kwargs = {"voice_description": description} if args.voice_design else {}
    if args.repetition_penalty != 1.05:
        kwargs["repetition_penalty"] = args.repetition_penalty
    plan = sample_plan(args.source.resolve(), reference, transcript,
                       args.temperature, args.seconds, args.seed, **kwargs)
    output.mkdir(parents=True, exist_ok=True)
    with locked(output):
        if args.reuse_raw and not (output / "raw").exists():
            reuse_raw_prefix(plan, output / "raw", args.reuse_raw.resolve())
        generate_raw(plan, output / "raw", reference, resume=args.resume or bool(args.reuse_raw), batch_size=args.batch_size)
        if args.raw_only:
            print(f"Prises prêtes : {output / 'raw'}", flush=True)
            return
        video = output / "video"
        if args.resume and (video / "result.json").is_file():
            result = read_json(video / "result.json")
            if file_hash(Path(result["output"])) != result["output_sha256"]:
                raise CLIError("L'export vidéo existant a changé.")
            final = Path(result["output"])
        else:
            final = retime(output / "raw", video, seconds=args.seconds)
        write_json(output / "result.json", {"output": str(final), "output_sha256": file_hash(final),
                   "natural_audio": str(output / "raw/natural.wav"), "temperature": args.temperature,
                   "raw_plan_sha256": file_hash(output / "raw/plan.json"), "french_speed": 1})
        print(f"Prêt : {final}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (CLIError, OSError, ValueError, KeyError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1)
