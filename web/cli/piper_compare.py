"""Auditable five-minute Tom/Pierre comparison, without touching the source project."""
import argparse
import copy
from pathlib import Path
import sys
import time

from tts_export import export, file_hash, run, sentence_end
from workspace import CLIError, load_project, project_file, source_digest, write_json


def sample_project(project, seconds):
    if not 1 <= seconds <= 1800:
        raise CLIError("La durée de l'essai doit être entre 1 et 1800 secondes.")
    selected = []
    for segment in project["segments"]:
        selected.append(segment)
        if segment["end_ms"] >= seconds * 1000 and sentence_end(segment["french"]):
            break
    if not selected or not sentence_end(selected[-1]["french"]):
        raise CLIError("Aucune fin de phrase sûre pour terminer l'essai.")
    result = copy.deepcopy(project)
    result["segments"] = copy.deepcopy(selected)
    result["duration_ms"] = selected[-1]["end_ms"] + 500
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=int, default=300)
    args = parser.parse_args()
    path = project_file(args.project).resolve()
    source = load_project(path, translated=True)
    video = path.parent / "source.mp4"
    sample = sample_project(source, args.seconds)
    output = args.output.resolve()
    if output.exists():
        raise CLIError("Le dossier de comparaison existe déjà : choisissez un nouveau dossier.")
    if not video.is_file():
        raise CLIError("source.mp4 manquant à côté du projet.")
    output.mkdir(parents=True)
    original_hash = file_hash(path)
    write_json(output / "project.json", sample)
    write_json(output / "comparison.json", {"source_project": str(path), "source_sha256": source_digest(source),
               "source_file_sha256": original_hash, "video_sha256": file_hash(video),
               "requested_seconds": args.seconds, "sample_end_ms": sample["segments"][-1]["end_ms"],
               "voices": ["Tom", "Pierre"], "original_db": -18, "text_changes": False})
    clip = output / "source.mp4"
    run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(video), "-t", str(sample["duration_ms"] / 1000),
         "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", str(clip)])
    for speaker in ("Tom", "Pierre"):
        start = time.monotonic()
        result = export(sample, clip, output / speaker.lower(), engine="piper", speaker=speaker, copy_video=True)
        print(f"{speaker} prêt en {time.monotonic() - start:.1f} s : {result['output']}", flush=True)
    if file_hash(path) != original_hash:
        raise CLIError("Le projet source a changé pendant la comparaison ; vérifier les modifications externes.")


if __name__ == "__main__":
    try:
        main()
    except (CLIError, OSError, ValueError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1)
