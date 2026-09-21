#!/usr/bin/env python3
"""Safely inspect and correct local Tarjama Studio project text."""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import difflib
import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import unicodedata
import uuid
from pathlib import Path
from typing import Any


class CorrectionError(Exception):
    pass


LIVE_FILES = ("project.json", "current.json", "transcript.json", "translation.json")
REVIEW_TRANSCRIPT_KEYS = ("transcriptReviewedAt", "transcriptReviewedFingerprint")
REVIEW_TRANSLATION_KEYS = ("translationReviewedAt", "translationReviewedFingerprint")
SAFE_PROJECT_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat(timespec="milliseconds").replace("+00:00", "Z")


def filename_timestamp() -> str:
    return utc_now().strftime("%Y%m%dT%H%M%SZ")


def default_projects_root() -> Path:
    system = platform.system()
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "Tarjama Studio" / "projects"
    if system == "Windows":
        appdata = os.environ.get("APPDATA")
        if not appdata:
            raise CorrectionError("APPDATA is unavailable; pass --root explicitly")
        return Path(appdata) / "Tarjama Studio" / "projects"
    config = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return config / "Tarjama Studio" / "projects"


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    return " ".join(value.split())


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CorrectionError(f"Missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise CorrectionError(f"Invalid JSON in {path}: {exc}") from exc


def json_bytes(payload: Any) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str | None:
    return sha256_bytes(path.read_bytes()) if path.exists() else None


def parse_updated(value: Any, fallback: float) -> float:
    if isinstance(value, str):
        try:
            return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            pass
    return fallback


def project_records(root: Path) -> list[dict[str, Any]]:
    if not root.is_dir():
        raise CorrectionError(f"Tarjama Studio project library not found: {root}")
    records: list[dict[str, Any]] = []
    for child in root.iterdir():
        metadata_path = child / "project.json"
        if not child.is_dir() or not metadata_path.is_file():
            continue
        try:
            metadata = read_json(metadata_path)
            if not isinstance(metadata, dict):
                continue
            modified = metadata_path.stat().st_mtime
            records.append(
                {
                    "id": str(metadata.get("id") or child.name),
                    "title": str(metadata.get("title") or child.name),
                    "updatedAt": metadata.get("updatedAt"),
                    "sort_time": parse_updated(metadata.get("updatedAt"), modified),
                    "path": str(child),
                    "hasTranscript": (child / "current.json").exists() or (child / "transcript.json").exists(),
                    "hasTranslation": (child / "translation.json").exists(),
                }
            )
        except (CorrectionError, OSError):
            continue
    records.sort(key=lambda item: item["sort_time"], reverse=True)
    return records


def public_record(record: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in record.items() if key != "sort_time"}


def resolve_project(root: Path, query: str) -> dict[str, Any]:
    records = project_records(root)
    query_key = normalized(query)
    exact = [r for r in records if normalized(r["id"]) == query_key or normalized(r["title"]) == query_key]
    if len(exact) == 1:
        return exact[0]
    contained = [r for r in records if query_key and query_key in normalized(r["title"])]
    if len(contained) == 1:
        return contained[0]
    scored = sorted(
        ((difflib.SequenceMatcher(None, query_key, normalized(r["title"])).ratio(), r) for r in records),
        key=lambda pair: pair[0],
        reverse=True,
    )
    if scored and scored[0][0] >= 0.82 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.12):
        return scored[0][1]
    candidates = [public_record(record) for _, record in scored[:5]]
    raise CorrectionError(
        "Project query is ambiguous or does not match strongly enough. Candidates: "
        + json.dumps(candidates, ensure_ascii=False)
    )


def safe_project_dir(root: Path, record: dict[str, Any]) -> Path:
    project_id = record["id"]
    if not SAFE_PROJECT_ID.fullmatch(project_id):
        raise CorrectionError(f"Unsafe project id: {project_id}")
    resolved_root = root.resolve()
    resolved_project = Path(record["path"]).resolve()
    if resolved_project.parent != resolved_root or resolved_project.name != project_id:
        raise CorrectionError(f"Project directory does not safely match its id: {resolved_project}")
    return resolved_project


def validate_transcript(payload: Any, label: str) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("segments"), list) or not payload["segments"]:
        raise CorrectionError(f"{label} must contain a non-empty segments array")
    seen: set[str] = set()
    previous_start = -1.0
    for index, segment in enumerate(payload["segments"]):
        if not isinstance(segment, dict):
            raise CorrectionError(f"{label} segment {index} is not an object")
        segment_id = str(segment.get("id", "")).strip()
        if not segment_id or segment_id in seen:
            raise CorrectionError(f"{label} has an empty or duplicate segment id at index {index}")
        seen.add(segment_id)
        start = segment.get("start")
        end = segment.get("end")
        if not isinstance(start, (int, float)) or isinstance(start, bool) or not math.isfinite(start):
            raise CorrectionError(f"{label} segment {segment_id} has an invalid start")
        if not isinstance(end, (int, float)) or isinstance(end, bool) or not math.isfinite(end):
            raise CorrectionError(f"{label} segment {segment_id} has an invalid end")
        if start < 0 or end < start or start < previous_start:
            raise CorrectionError(f"{label} segment {segment_id} has invalid or unordered timestamps")
        previous_start = float(start)
        if not isinstance(segment.get("text"), str) or not isinstance(segment.get("translation"), str):
            raise CorrectionError(f"{label} segment {segment_id} must contain string text and translation")
    return payload


def validate_translation(payload: Any, transcript: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("segments"), list):
        raise CorrectionError("translation.json must contain a segments array")
    source_segments = transcript["segments"]
    translated = payload["segments"]
    if len(source_segments) != len(translated):
        raise CorrectionError("Translation segment count does not match the transcript")
    for source, target in zip(source_segments, translated):
        if not isinstance(target, dict):
            raise CorrectionError(f"Translation segment for {source['id']} is not an object")
        if str(source["id"]) != str(target.get("id")):
            raise CorrectionError(f"Translation segment id mismatch at {source['id']}")
        start = target.get("start")
        end = target.get("end")
        if not isinstance(start, (int, float)) or isinstance(start, bool) or not math.isfinite(start):
            raise CorrectionError(f"Translation start is invalid at segment {source['id']}")
        if not isinstance(end, (int, float)) or isinstance(end, bool) or not math.isfinite(end):
            raise CorrectionError(f"Translation end is invalid at segment {source['id']}")
        if round(float(source["start"]) * 1000) != round(float(start) * 1000):
            raise CorrectionError(f"Translation start mismatch at segment {source['id']}")
        if round(float(source["end"]) * 1000) != round(float(end) * 1000):
            raise CorrectionError(f"Translation end mismatch at segment {source['id']}")
        if not isinstance(target.get("translation"), str):
            raise CorrectionError(f"Translation text is invalid at segment {source['id']}")
    return payload


def load_state(project_dir: Path) -> dict[str, Any]:
    project = read_json(project_dir / "project.json")
    if not isinstance(project, dict):
        raise CorrectionError("project.json must be an object")
    live_transcript_path = project_dir / "current.json"
    if not live_transcript_path.exists():
        live_transcript_path = project_dir / "transcript.json"
    transcript = validate_transcript(read_json(live_transcript_path), live_transcript_path.name)
    translation_path = project_dir / "translation.json"
    translation = read_json(translation_path) if translation_path.exists() else None
    if translation is not None:
        validate_translation(translation, transcript)
    return {"project": project, "transcript": transcript, "translation": translation}


def combined_transcript(transcript: dict[str, Any], translation: dict[str, Any] | None) -> dict[str, Any]:
    combined = copy.deepcopy(transcript)
    translated = {str(item["id"]): item["translation"] for item in translation["segments"]} if translation else {}
    for segment in combined["segments"]:
        segment["translation"] = translated.get(str(segment["id"]), "")
    return combined


def segment_rows(state: dict[str, Any]) -> list[dict[str, Any]]:
    translations = (
        {str(item["id"]): item["translation"] for item in state["translation"]["segments"]}
        if state["translation"]
        else {}
    )
    return [
        {
            "id": str(segment["id"]),
            "start": segment["start"],
            "end": segment["end"],
            "text": segment["text"],
            "translation": translations.get(str(segment["id"]), ""),
        }
        for segment in state["transcript"]["segments"]
    ]


def project_summary(root: Path, record: dict[str, Any], include_segments: bool) -> dict[str, Any]:
    project_dir = safe_project_dir(root, record)
    state = load_state(project_dir)
    result = public_record(record)
    result["hashes"] = {name: sha256_file(project_dir / name) for name in LIVE_FILES}
    result["segmentCount"] = len(state["transcript"]["segments"])
    result["review"] = {
        "transcriptReviewedAt": state["project"].get("transcriptReviewedAt"),
        "translationReviewedAt": state["project"].get("translationReviewedAt"),
    }
    if include_segments:
        result["segments"] = segment_rows(state)
    return result


def load_plan(path: Path) -> dict[str, Any]:
    plan = read_json(path)
    if not isinstance(plan, dict) or not isinstance(plan.get("project_id"), str):
        raise CorrectionError("Plan must contain a string project_id")
    if not isinstance(plan.get("changes"), list) or not plan["changes"]:
        raise CorrectionError("Plan must contain a non-empty changes array")
    return plan


def evaluate_plan(root: Path, plan: dict[str, Any], mutate: bool) -> tuple[dict[str, Any], dict[str, Any]]:
    record = resolve_project(root, plan["project_id"])
    if record["id"] != plan["project_id"]:
        raise CorrectionError("Apply plans must use the exact project id returned by inspect")
    state = load_state(safe_project_dir(root, record))
    transcript = copy.deepcopy(state["transcript"])
    translation = copy.deepcopy(state["translation"])
    text_by_id = {str(item["id"]): item for item in transcript["segments"]}
    translation_by_id = (
        {str(item["id"]): item for item in translation["segments"]} if translation is not None else {}
    )
    seen: set[tuple[str, str]] = set()
    preview: list[dict[str, Any]] = []
    text_changed = False
    translation_changed = False
    for index, change in enumerate(plan["changes"]):
        if not isinstance(change, dict):
            raise CorrectionError(f"Change {index} is not an object")
        segment_id = str(change.get("segment_id", ""))
        field = change.get("field")
        expected = change.get("expected")
        replacement = change.get("replacement")
        if field not in ("text", "translation"):
            raise CorrectionError(f"Change {index} field must be text or translation")
        if not isinstance(expected, str) or not isinstance(replacement, str):
            raise CorrectionError(f"Change {index} expected and replacement must be strings")
        target_key = (segment_id, field)
        if target_key in seen:
            raise CorrectionError(f"Duplicate change target: segment {segment_id} {field}")
        seen.add(target_key)
        target = text_by_id.get(segment_id) if field == "text" else translation_by_id.get(segment_id)
        if target is None:
            raise CorrectionError(f"No {field} target for segment {segment_id}")
        current = target[field]
        if current != expected:
            raise CorrectionError(
                f"Stale expected value for segment {segment_id} {field}. Current value: {json.dumps(current, ensure_ascii=False)}"
            )
        if replacement == expected:
            raise CorrectionError(f"Change for segment {segment_id} {field} is a no-op")
        source = text_by_id[segment_id]
        preview.append(
            {
                "segment_id": segment_id,
                "start": source["start"],
                "end": source["end"],
                "field": field,
                "before": expected,
                "after": replacement,
                "reason": change.get("reason", ""),
            }
        )
        if mutate:
            target[field] = replacement
        text_changed = text_changed or field == "text"
        translation_changed = translation_changed or field == "translation"
    invalidated = ["translation"] if translation_changed else []
    if text_changed:
        invalidated = ["transcript", "translation"]
    result = {
        "project": {"id": record["id"], "title": record["title"], "updatedAt": record["updatedAt"]},
        "changes": preview,
        "reviewConfirmationsCleared": invalidated,
    }
    return result, {"project": state["project"], "transcript": transcript, "translation": translation}


def app_processes() -> list[str]:
    if platform.system() != "Darwin":
        return []
    try:
        output = subprocess.run(
            ["ps", "-axo", "pid=,command="], check=True, capture_output=True, text=True
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return []
    matches = []
    for line in output.splitlines():
        is_packaged = "Tarjama Studio.app/Contents/MacOS/Tarjama Studio" in line
        is_development = "Electron.app/Contents/MacOS/Electron" in line and "dist-electron/main.js" in line
        if is_packaged or is_development:
            matches.append(line.strip())
    return matches


def write_exclusive_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json_bytes(payload)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        path.unlink(missing_ok=True)
        raise


def unique_snapshot_path(directory: Path, prefix: str, stamp: str) -> Path:
    candidate = directory / f"{prefix}_{stamp}.json"
    index = 1
    while candidate.exists():
        candidate = directory / f"{prefix}_{stamp}_{index}.json"
        index += 1
    return candidate


def write_snapshot(directory: Path, prefix: str, stamp: str, payload: dict[str, Any], project_id: str, now: str) -> Path:
    snapshot = copy.deepcopy(payload)
    snapshot["corpus_id"] = project_id
    snapshot["snapshot_at"] = now
    path = unique_snapshot_path(directory, prefix, stamp)
    write_exclusive_json(path, snapshot)
    return path


def atomic_write(path: Path, payload: bytes) -> None:
    temporary = path.with_name(f".{path.name}.codex-{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def create_backup(project_dir: Path, stamp: str, plan: dict[str, Any]) -> Path:
    root = project_dir / "codex_backups"
    root.mkdir(exist_ok=True)
    backup = root / stamp
    index = 1
    while backup.exists():
        backup = root / f"{stamp}_{index}"
        index += 1
    backup.mkdir()
    hashes: dict[str, str | None] = {}
    for name in LIVE_FILES:
        source = project_dir / name
        hashes[name] = sha256_file(source)
        if source.exists():
            shutil.copy2(source, backup / name)
    manifest = {"created_at": iso_now(), "files": hashes, "plan": plan}
    write_exclusive_json(backup / "manifest.json", manifest)
    return backup


def apply_plan(root: Path, plan: dict[str, Any], app_closed: bool) -> dict[str, Any]:
    if not app_closed:
        raise CorrectionError("Refusing to write without --app-is-closed")
    running = app_processes()
    if running:
        raise CorrectionError("Tarjama Studio still appears to be running: " + " | ".join(running))
    preview, changed = evaluate_plan(root, plan, mutate=True)
    project_dir = safe_project_dir(root, resolve_project(root, plan["project_id"]))
    lock_path = project_dir / ".codex-correction.lock"
    try:
        lock_descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as exc:
        raise CorrectionError(f"Correction lock already exists: {lock_path}") from exc
    os.close(lock_descriptor)
    originals = {name: (project_dir / name).read_bytes() if (project_dir / name).exists() else None for name in LIVE_FILES}
    stamp = filename_timestamp()
    now = iso_now()
    created_snapshots: list[Path] = []
    replaced: list[str] = []
    try:
        # Re-evaluate under the lock so stale text cannot be overwritten.
        preview, changed = evaluate_plan(root, plan, mutate=True)
        old_state = load_state(project_dir)
        backup = create_backup(project_dir, stamp, plan)
        old_combined = combined_transcript(old_state["transcript"], old_state["translation"])
        created_snapshots.append(
            write_snapshot(project_dir / "snapshots", "pre_codex_correction", stamp, old_combined, plan["project_id"], now)
        )
        if old_state["translation"] is not None:
            created_snapshots.append(
                write_snapshot(
                    project_dir / "translation_snapshots",
                    "pre_codex_correction",
                    stamp,
                    old_state["translation"],
                    plan["project_id"],
                    now,
                )
            )

        transcript = changed["transcript"]
        transcript["corpus_id"] = plan["project_id"]
        transcript["updated_at"] = now
        for segment in transcript["segments"]:
            segment["translation"] = ""
        translation = changed["translation"]
        if translation is not None:
            translation["corpus_id"] = plan["project_id"]
            translation["updated_at"] = now
            validate_translation(translation, transcript)
        project = changed["project"]
        project["updatedAt"] = now
        project["transcriptPath"] = str(project_dir / "transcript.json")
        if translation is not None:
            project["translationPath"] = str(project_dir / "translation.json")
        cleared = preview["reviewConfirmationsCleared"]
        if "transcript" in cleared:
            for key in REVIEW_TRANSCRIPT_KEYS:
                project.pop(key, None)
        if "translation" in cleared:
            for key in REVIEW_TRANSLATION_KEYS:
                project.pop(key, None)

        outputs = {
            "current.json": json_bytes(transcript),
            "transcript.json": json_bytes(transcript),
            "project.json": json_bytes(project),
        }
        if translation is not None:
            outputs["translation.json"] = json_bytes(translation)
        for name, payload in outputs.items():
            atomic_write(project_dir / name, payload)
            replaced.append(name)

        post_combined = combined_transcript(transcript, translation)
        created_snapshots.append(
            write_snapshot(project_dir / "snapshots", "save", stamp, post_combined, plan["project_id"], now)
        )
        if translation is not None:
            created_snapshots.append(
                write_snapshot(
                    project_dir / "translation_snapshots", "save", stamp, translation, plan["project_id"], now
                )
            )
        # Final read validates the exact on-disk state.
        final_state = load_state(project_dir)
        if json_bytes(final_state["transcript"]) != json_bytes(transcript):
            raise CorrectionError("Final transcript verification failed")
        preview["backup"] = str(backup)
        preview["snapshots"] = [str(path) for path in created_snapshots]
        preview["appliedAt"] = now
        return preview
    except Exception:
        for name in replaced:
            original = originals[name]
            target = project_dir / name
            if original is None:
                target.unlink(missing_ok=True)
            else:
                atomic_write(target, original)
        raise
    finally:
        lock_path.unlink(missing_ok=True)


def command_list(args: argparse.Namespace) -> dict[str, Any]:
    records = project_records(args.root)[: args.limit]
    return {"root": str(args.root), "projects": [public_record(record) for record in records]}


def command_inspect(args: argparse.Namespace) -> dict[str, Any]:
    record = resolve_project(args.root, args.project)
    return project_summary(args.root, record, args.segments)


def command_search(args: argparse.Namespace) -> dict[str, Any]:
    if args.project:
        records = [resolve_project(args.root, args.project)]
    else:
        records = project_records(args.root)[: args.recent]
    needles = [(value, normalized(value)) for value in args.text]
    projects: list[dict[str, Any]] = []
    for record in records:
        state = load_state(safe_project_dir(args.root, record))
        hits = []
        for row in segment_rows(state):
            for original, needle in needles:
                fields = [field for field in ("text", "translation") if needle and needle in normalized(row[field])]
                if fields:
                    hits.append({"needle": original, "fields": fields, **row})
        if hits:
            projects.append({"id": record["id"], "title": record["title"], "updatedAt": record["updatedAt"], "hits": hits})
    return {"root": str(args.root), "searchedProjects": len(records), "matches": projects}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=default_projects_root(), help="Explicit projects directory")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="List recent projects")
    list_parser.add_argument("--limit", type=int, default=8)
    list_parser.set_defaults(handler=command_list)

    inspect_parser = subparsers.add_parser("inspect", help="Inspect one unambiguous project")
    inspect_parser.add_argument("--project", required=True)
    inspect_parser.add_argument("--segments", action="store_true")
    inspect_parser.set_defaults(handler=command_inspect)

    search_parser = subparsers.add_parser("search", help="Search existing segment wording")
    search_parser.add_argument("--project")
    search_parser.add_argument("--recent", type=int, default=8)
    search_parser.add_argument("--text", action="append", required=True)
    search_parser.set_defaults(handler=command_search)

    preview_parser = subparsers.add_parser("preview", help="Validate and preview an exact correction plan")
    preview_parser.add_argument("--plan", type=Path, required=True)
    preview_parser.set_defaults(handler=lambda args: evaluate_plan(args.root, load_plan(args.plan), mutate=False)[0])

    apply_parser = subparsers.add_parser("apply", help="Apply a previously previewed plan")
    apply_parser.add_argument("--plan", type=Path, required=True)
    apply_parser.add_argument("--app-is-closed", action="store_true")
    apply_parser.set_defaults(
        handler=lambda args: apply_plan(args.root, load_plan(args.plan), args.app_is_closed)
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    args.root = args.root.expanduser().resolve()
    try:
        result = args.handler(args)
    except (CorrectionError, OSError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
