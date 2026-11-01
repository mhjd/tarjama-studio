"""Retry one failed Groq checkpoint in smaller pieces, using web validation."""
import argparse
import json
from pathlib import Path
import time

from api_workflow import bridge, engine_fingerprint
from tts_export import file_hash, probe, run
from workspace import CLIError, ROOT, load_project, locked, read_json, source_digest, write_json


def retry(project_path, audit, index, part_seconds, corpus):
    project_path = project_path.resolve()
    if project_path.is_dir():
        project_path /= "project.json"
    if index < 0 or not 60 <= part_seconds <= 300:
        raise CLIError("Index >=0 et morceaux de 60 à 300 secondes requis.")
    with locked(project_path.parent):
        project = load_project(project_path, allow_empty=True)
        if project["segments"]:
            raise CLIError("Le projet contient déjà une transcription.")
        video = project_path.parent / "source.mp4"
        identity = read_json(audit / "identity.json")
        expected = {"kind": "transcribe", "source": source_digest(project),
                    "engine": engine_fingerprint(corpus.resolve()),
                    "binary": file_hash(ROOT / "web/.cache/local-api"), "video": file_hash(video)}
        if identity != expected or audit.resolve().parent != (project_path.parent / "api_runs").resolve():
            raise CLIError("Le checkpoint ne correspond pas au projet/moteur courant.")
        cached = audit / f"{index:04d}.json"
        if cached.exists():
            raise CLIError("Ce morceau a déjà un checkpoint : aucun écrasement.")
        total_ms = probe(video)["duration_ms"]
        start = index * 580.0
        duration = min(600.0, total_ms / 1000 - start)
        if duration <= 0:
            raise CLIError("Morceau hors média.")
        folder = audit / f"retry-{index:04d}-{time.time_ns()}"
        folder.mkdir()
        chunks, position, number = [], start, 0
        while position < start + duration:
            seconds = min(part_seconds, start + duration - position)
            print(f"Groq reprise {index + 1}.{number + 1} : {position:.1f}–{position + seconds:.1f} s", flush=True)
            audio = folder / f"{number:04d}.flac"
            run(["ffmpeg", "-nostdin", "-v", "error", "-ss", str(position), "-i", str(video),
                 "-t", str(seconds), "-vn", "-ar", "16000", "-ac", "1", "-c:a", "flac", str(audio)])
            chunk = bridge({"kind": "audio", "audio": str(audio), "start": position, "duration": seconds}, folder)
            write_json(folder / f"{number:04d}-response.json", chunk)
            bridge({"kind": "merge-asr", "asr_chunks": [chunk], "total_duration": total_ms}, folder)
            chunks.append(chunk)
            position += seconds
            number += 1
        segments = bridge({"kind": "merge-asr", "asr_chunks": chunks, "total_duration": total_ms}, folder)
        # Web MergeASR has validated/normalized the subchunks. Keep every raw
        # response and convert only their timestamps back to checkpoint-local.
        recovered = {"start": start, "duration": duration, "response": {"segments": [
            {"start": (s["start_ms"] - round(start * 1000)) / 1000,
             "end": (s["end_ms"] - round(start * 1000)) / 1000, "text": s["arabic"]}
            for s in segments]}, "raw": {"recovery": "validated-subchunks", "chunks": chunks}}
        bridge({"kind": "merge-asr", "asr_chunks": [recovered], "total_duration": total_ms}, folder)
        write_json(cached, recovered)
        print(f"Checkpoint {index + 1} réparé par retranscription ; sources brutes conservées dans {folder}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--index", type=int, required=True, help="Index du morceau, à partir de zéro")
    parser.add_argument("--part-seconds", type=int, default=180)
    parser.add_argument("--corpus", type=Path, default=Path("data/reference_corpus/20260925-v2"))
    args = parser.parse_args()
    try:
        retry(args.project, args.audit.resolve(), args.index, args.part_seconds, args.corpus)
    except (CLIError, OSError, ValueError) as exc:
        import sys
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1)
