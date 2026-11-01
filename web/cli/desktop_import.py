"""Read-only desktop → local CLI copy; never writes to the desktop library."""

import hashlib
import json
import math
from pathlib import Path
import shutil

from workspace import CLIError, atomic_write, load_project, write_json
from tts_export import file_hash, probe


def import_desktop(source: Path, output: Path) -> dict:
    source, output = source.resolve(), output.resolve()
    if output == source or source in output.parents:
        raise CLIError("La copie doit rester hors du projet desktop.")
    names = ("project.json", "current.json", "translation.json")
    captured = {name: (source / name).read_bytes() for name in names}
    metadata, transcript, translation = (json.loads(captured[name]) for name in names)
    rows, translated = transcript["segments"], translation["segments"]
    if not rows or len(rows) != len(translated):
        raise CLIError("Transcription et traduction desktop de tailles différentes.")
    if transcript.get("corpus_id") != metadata["id"] or translation.get("corpus_id") != metadata["id"]:
        raise CLIError("La traduction ne correspond pas au projet desktop.")

    def milliseconds(value):
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            raise CLIError("Timestamp desktop invalide.")
        return round(value * 1000)

    def alignment(row):
        return str(row["id"]), milliseconds(row["start"]), milliseconds(row["end"])

    if [alignment(row) for row in rows] != [alignment(row) for row in translated]:
        raise CLIError("IDs/timestamps desktop désalignés : aucune traduction devinée.")
    fingerprint = translation.get("source_transcript_fingerprint")
    if fingerprint and [alignment(row) for row in json.loads(fingerprint)] != [alignment(row) for row in rows]:
        raise CLIError("La traduction desktop possède une empreinte d'alignement périmée.")
    video = source / "source.mp4"
    info = probe(video)
    project = {"id": metadata["id"], "title": metadata["title"], "version": 1,
               "arabic_version": 1, "duration_ms": info["duration_ms"], "segments": [
                   {"id": str(row["id"]), "start_ms": milliseconds(row["start"]),
                    "end_ms": milliseconds(row["end"]), "arabic": row["text"],
                    "french": fr["translation"], "version": 1}
                   for row, fr in zip(rows, translated)
               ]}
    # The destination must be new. Preserve exact source JSON alongside the conversion.
    output.mkdir(parents=True, exist_ok=False)
    audit = output / "desktop_source"
    audit.mkdir()
    for name, data in captured.items():
        atomic_write(audit / name, data)
    pending = output / "project.pending.json"
    write_json(pending, project)
    load_project(pending, translated=True)
    original_hash = file_hash(video)
    shutil.copyfile(video, output / "source.mp4")
    if (file_hash(output / "source.mp4") != original_hash or file_hash(video) != original_hash
            or any((source / name).read_bytes() != data for name, data in captured.items())):
        raise CLIError("Le projet desktop a changé pendant la copie ; recommencez dans un nouveau dossier.")
    write_json(output / "desktop-import.json", {
        "source": str(source), "read_only": True, "video_sha256": original_hash,
        "source_sha256": {name: hashlib.sha256(data).hexdigest() for name, data in captured.items()},
    })
    pending.replace(output / "project.json")
    return project
