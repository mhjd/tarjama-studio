"""Local, manual workspaces using the hosted app's Project/Segment JSON contract."""

from __future__ import annotations

import contextlib
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
ID = re.compile(r"^[a-zA-Z0-9_-]{1,160}$")
TIME = re.compile(r"^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$")
HEADER = re.compile(r"^##\s+(.+?)\s+-->\s+(.+?)\s*$", re.M)
CITATIONS = re.compile(r"\ue200(?:cite|filecite)\ue202[^\ue201\r\n]*\ue201[ \t]*")


class CLIError(Exception):
    pass


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        raise CLIError(f"Lecture JSON impossible : {path} ({exc})") from exc


def write_json(path: Path, value) -> None:
    atomic_write(path, (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode())


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".tarjama-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


@contextlib.contextmanager
def locked(directory: Path):
    # Kernel releases this lock after a crash; no stale O_EXCL sentinel to remove.
    import fcntl

    with (directory / ".tarjama.lock").open("a+b") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise CLIError(f"Une autre commande utilise {directory}") from exc
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def project_file(path: Path) -> Path:
    return path / "project.json" if path.is_dir() else path


def load_project(path: Path, *, translated=False, allow_empty=False) -> dict:
    value = read_json(project_file(path))
    if isinstance(value, dict) and "project" in value:
        value = value["project"]  # GET /api/projects/{id} response
    if not isinstance(value, dict) or not ID.fullmatch(str(value.get("id", ""))):
        raise CLIError("Projet web invalide : id et segments attendus, pas un ancien corpus desktop.")
    segments = value.get("segments")
    if not isinstance(segments, list) or len(segments) > 50000 or (not segments and not allow_empty):
        raise CLIError("Le projet doit contenir des segments (importez d'abord la transcription).")
    seen = set()
    previous_end = 0
    for segment in segments:
        if not isinstance(segment, dict):
            raise CLIError("Segment invalide")
        sid = segment.get("id", "")
        start, end = segment.get("start_ms"), segment.get("end_ms")
        if not isinstance(sid, str) or not ID.fullmatch(sid) or sid in seen:
            raise CLIError(f"Identifiant de segment invalide ou dupliqué : {sid}")
        seen.add(sid)
        if type(start) is not int or type(end) is not int or start < previous_end or end <= start:
            raise CLIError(f"Horodatages en millisecondes invalides/chevauchants : {sid}")
        if not isinstance(segment.get("arabic"), str) or not segment["arabic"].strip():
            raise CLIError(f"Texte arabe absent : {sid}")
        french = segment.get("french", "")
        if not isinstance(french, str) or (translated and not french.strip()):
            raise CLIError(f"Traduction française absente : {sid}")
        previous_end = end
    duration = value.get("duration_ms", 0)
    if type(duration) is not int or duration < 0 or (duration and duration < previous_end):
        raise CLIError("Durée du projet invalide")
    return value


def milliseconds(text: str) -> int:
    match = TIME.fullmatch(text.strip())
    if not match:
        raise CLIError(f"Horodatage invalide : {text}")
    hours = int(match[1] or 0)
    minutes, seconds = int(match[2]), float(match[3])
    if minutes >= 60 or seconds >= 60 or not math.isfinite(seconds) or hours > 100000:
        raise CLIError(f"Horodatage invalide : {text}")
    return round((hours * 3600 + minutes * 60 + seconds) * 1000)


def timecode(ms: int, separator=".") -> str:
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}{separator}{ms % 1000:03d}"


def source_digest(project: dict) -> str:
    payload = {"id": project["id"], "segments": project["segments"]}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def prompt(project: dict, kind: str) -> str:
    template = ROOT / "prompts" / ("transcript_cleanup.md" if kind == "cleanup" else "translation.md")
    blocks = "\n\n".join(
        f"## {timecode(s['start_ms'])} --> {timecode(s['end_ms'])}\n{s['arabic']}"
        for s in project["segments"]
    )
    text = template.read_text(encoding="utf-8")
    for key, value in {
        "corpus_id": project["id"], "title": project.get("title", ""),
        "source_blocks": blocks, "project_instructions_block": "",
    }.items():
        text = text.replace("{{" + key + "}}", value)
    # Hosted-only tool routing is unavailable in a normal ChatGPT conversation.
    # Adapt the transport instruction, keeping the current reference policy.
    text = text.replace("utilise `web_search`, puis `web_fetch` si les extraits ne suffisent pas.",
                        "utilise la recherche web disponible dans cette conversation si nécessaire.")
    text = text.replace("Ces deux outils passent exclusivement par Parallel, quel que soit le modèle utilisé. N'utilise aucun moteur natif ni un autre moteur en repli.",
                        "Ne prétends pas disposer des outils serveur de Tarjama ; utilise seulement les outils effectivement disponibles dans cette conversation ChatGPT.")
    if kind == "cleanup":
        # The local manual importer has no deletion-review screen. Narrow the
        # template's permission to delete noise instead of silently losing IDs.
        text = ("Consigne propre à cet échange CLI : conserve tous les blocs, même ceux qui paraissent inutiles. "
                "La suppression de blocs n'est pas autorisée dans cet import.\n\n" + text)
    return text


def parse_response(content: str, project: dict, kind: str) -> list[dict]:
    content = re.sub(r"<!--\s*\ue200(?:cite|filecite)\ue202[^\ue201\r\n]*\ue201\s*-->", "", content)
    content = CITATIONS.sub("", content).strip()
    if content.startswith("```"):
        lines = content.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            content = "\n".join(lines[1:-1])
    metadata = re.search(r"^source_corpus_id:\s*(\S+)\s*$", content, re.M)
    if not metadata or metadata[1] != project["id"]:
        raise CLIError("source_corpus_id absent ou différent : réponse d'un autre projet ?")
    if kind == "translation":
        for key, expected_value in (("language", "fr"), ("format", "tarjama-translation-v1")):
            field = re.search(r"^" + key + r":\s*(\S+)\s*$", content, re.M)
            if not field or field[1] != expected_value:
                raise CLIError(f"Métadonnée {key} absente ou incorrecte")
    headers = list(HEADER.finditer(content))
    if not headers:
        raise CLIError("Aucun bloc Markdown ## début --> fin")
    expected = {(s["start_ms"], s["end_ms"]): s for s in project["segments"]}
    if len(expected) != len(project["segments"]):
        raise CLIError("Intervalles dupliqués dans le projet")
    results, seen, last = [], set(), -1
    for index, header in enumerate(headers):
        key = (milliseconds(header[1]), milliseconds(header[2]))
        if key not in expected or key in seen or key[0] < last:
            raise CLIError(f"Bloc ajouté, dupliqué, déplacé ou timestamps modifiés : {header[0]}")
        seen.add(key)
        last = key[0]
        stop = headers[index + 1].start() if index + 1 < len(headers) else len(content)
        text = content[header.end():stop].strip()
        if not text or len(text) > 16000 or re.search(r"^#{1,6}\s", text, re.M):
            raise CLIError(f"Bloc vide ou contenu inattendu : {header[0]}")
        segment = copy.deepcopy(expected[key])
        segment["arabic" if kind == "cleanup" else "french"] = text
        if kind == "cleanup":
            segment["french"] = ""
        segment["version"] = segment.get("version", 0) + 1
        results.append(segment)
    if len(results) != len(project["segments"]):
        raise CLIError("Des blocs manquent. Une suppression doit être demandée explicitement, jamais déduite d'une réponse tronquée.")
    return results


def clipboard(*, text: str | None = None) -> str:
    if sys.platform == "darwin":
        command = ["pbcopy"] if text is not None else ["pbpaste"]
    else:
        import shutil
        if shutil.which("wl-copy") and shutil.which("wl-paste"):
            command = ["wl-copy"] if text is not None else ["wl-paste", "--no-newline"]
        else:
            command = ["xclip", "-selection", "clipboard"] + ([] if text is not None else ["-o"])
    try:
        return subprocess.run(command, input=text, text=True, capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError) as exc:
        raise CLIError("Presse-papiers indisponible ; utilisez --file ou le fichier prompt.md.") from exc
