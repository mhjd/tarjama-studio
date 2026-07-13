#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data/manifests/dedew_manifest.jsonl"
WORKSPACES = ROOT / "data/workspaces"
LOCAL_WHISPER_DIR = ROOT / "data/model_outputs/whisper_large_v3_mlx"
TRANSCRIPT_EXPORT_DIR = ROOT / "exports/transcriptions"
LOCAL_WHISPER_MODEL = "mlx-community/whisper-large-v3-mlx"
ASR_PYTHON = ROOT / ".venv-asr/bin/python"
YTDLP = ROOT / ".venv/bin/yt-dlp"
FFMPEG = ROOT / ".venv/lib/python3.14/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1"
DEFAULT_CLEANUP_PROMPT = ROOT / "prompts/transcript_cleanup.md"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_manifest() -> list[dict[str, Any]]:
    if not MANIFEST.exists():
        return []
    rows = []
    with MANIFEST.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def append_manifest(row: dict[str, Any]) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def write_manifest(rows: list[dict[str, Any]]) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def replace_manifest_row(updated: dict[str, Any]) -> None:
    rows = read_manifest()
    for index, row in enumerate(rows):
        if row.get("corpus_id") == updated.get("corpus_id"):
            rows[index] = updated
            write_manifest(rows)
            return
    raise SystemExit(f"Unknown corpus_id: {updated.get('corpus_id')}")


def find_row(corpus_id: str) -> dict[str, Any]:
    for row in read_manifest():
        if row["corpus_id"] == corpus_id:
            return row
    raise SystemExit(f"Unknown corpus_id: {corpus_id}")


def workspace_path(corpus_id: str) -> Path:
    return WORKSPACES / corpus_id / "transcript.json"


def autosave_path(corpus_id: str) -> Path:
    return WORKSPACES / corpus_id / "autosave.json"


def snapshots_path(corpus_id: str) -> Path:
    return WORKSPACES / corpus_id / "snapshots"


def whisper_json_path(corpus_id: str) -> Path:
    return LOCAL_WHISPER_DIR / f"{corpus_id}.json"


def copy_export_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def export_transcript_for_electron(
    row: dict[str, Any],
    transcript_path: Path,
    transcript_kind: str,
) -> Path:
    """Expose the transcript near the repo root for Electron's Importer transcription flow."""
    corpus_id = row["corpus_id"]
    out_dir = TRANSCRIPT_EXPORT_DIR / transcript_export_folder(row)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not transcript_path.exists():
        raise SystemExit(f"Missing transcript to export: {transcript_path}")
    named_transcript = out_dir / f"transcript_{transcript_kind}.json"
    active_transcript = out_dir / "transcript_import.json"
    copy_export_file(transcript_path, named_transcript)
    copy_export_file(transcript_path, active_transcript)

    metadata = {
        "corpus_id": corpus_id,
        "title": row.get("title"),
        "youtube_url": row.get("youtube_url"),
        "export_label": row.get("export_label"),
        "transcript_to_import": active_transcript.name,
        "kind": transcript_kind,
        "updated_at": now_iso(),
    }
    (out_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (out_dir / "README.txt").write_text(
        "Transcription prête pour Tarjama Studio.\n"
        "Dans le projet vidéo correspondant, utilise Importer transcription puis choisis transcript_import.json.\n"
        "transcript_whisper.json est la sortie brute locale si disponible; transcript_cleaned.json est la version nettoyée si disponible.\n",
        encoding="utf-8",
    )
    print(f"[export] {active_transcript.relative_to(ROOT)}")
    return active_transcript


def has_subtitle(row: dict[str, Any]) -> bool:
    corpus_id = row["corpus_id"]
    return workspace_path(corpus_id).exists() or autosave_path(corpus_id).exists() or whisper_json_path(corpus_id).exists()


def slugify(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9]+", "_", value.strip()).strip("_").lower()
    return value or "video"


ARABIC_TRANSLIT = {
    "ا": "a",
    "أ": "a",
    "إ": "i",
    "آ": "a",
    "ب": "b",
    "ت": "t",
    "ث": "th",
    "ج": "j",
    "ح": "h",
    "خ": "kh",
    "د": "d",
    "ذ": "dh",
    "ر": "r",
    "ز": "z",
    "س": "s",
    "ش": "sh",
    "ص": "s",
    "ض": "d",
    "ط": "t",
    "ظ": "z",
    "ع": "a",
    "غ": "gh",
    "ف": "f",
    "ق": "q",
    "ك": "k",
    "ل": "l",
    "م": "m",
    "ن": "n",
    "ه": "h",
    "ة": "h",
    "و": "w",
    "ؤ": "w",
    "ي": "y",
    "ى": "a",
    "ئ": "y",
    "ء": "",
    "لا": "la",
}


def transliterate_word(value: str) -> str:
    output = []
    index = 0
    while index < len(value):
        pair = value[index : index + 2]
        if pair in ARABIC_TRANSLIT:
            output.append(ARABIC_TRANSLIT[pair])
            index += 2
            continue
        char = value[index]
        output.append(ARABIC_TRANSLIT.get(char, char))
        index += 1
    return "".join(output)


def default_export_label(title: str, word_count: int = 4) -> str:
    words = re.findall(r"[A-Za-z0-9\u0600-\u06FF]+", title)
    label = "_".join(transliterate_word(word) for word in words[:word_count])
    return slugify(label)[:56].strip("_") or "video"


def transcript_export_folder(row: dict[str, Any]) -> str:
    label = slugify(str(row.get("export_label") or ""))
    return f"{row['corpus_id']}__{label}" if label else row["corpus_id"]


def youtube_id_from_info(info: dict[str, Any]) -> str:
    video_id = info.get("id")
    if not video_id:
        raise SystemExit("yt-dlp did not return a video id")
    return str(video_id)


def run(command: list[str]) -> None:
    print("+ " + " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def write_workspace_from_whisper(row: dict[str, Any]) -> Path:
    corpus_id = row["corpus_id"]
    source = whisper_json_path(corpus_id)
    if not source.exists():
        raise SystemExit(f"Missing Whisper JSON: {source}")

    raw = json.loads(source.read_text(encoding="utf-8"))
    segments = []
    for index, segment in enumerate(raw.get("segments", [])):
        segments.append(
            {
                "id": str(segment.get("id", index)),
                "start": float(segment.get("start", 0.0)),
                "end": float(segment.get("end", 0.0)),
                "text": str(segment.get("text", "")).strip(),
                "translation": "",
            }
        )

    payload = {
        "corpus_id": corpus_id,
        "audio_path": row.get("audio_path"),
        "source_transcript": str(source.relative_to(ROOT)),
        "source_model": raw.get("model"),
        "project_instructions": "",
        "segments": segments,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    out = workspace_path(corpus_id)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    export_transcript_for_electron(row, out, "whisper")
    return out


def read_workspace_or_create(row: dict[str, Any]) -> dict[str, Any]:
    corpus_id = row["corpus_id"]
    path = workspace_path(corpus_id)
    if not path.exists():
        if whisper_json_path(corpus_id).exists():
            path = write_workspace_from_whisper(row)
        else:
            raise SystemExit(f"Missing workspace transcript: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def render_cleanup_prompt(row: dict[str, Any], transcript: dict[str, Any], prompt_path: Path) -> str:
    if not prompt_path.exists():
        raise SystemExit(f"Missing cleanup prompt template: {prompt_path}")
    template = prompt_path.read_text(encoding="utf-8")
    transcript_json = json.dumps(transcript, ensure_ascii=False, indent=2)
    return (
        template.replace("{{corpus_id}}", str(row["corpus_id"]))
        .replace("{{title}}", str(row.get("title") or row["corpus_id"]))
        .replace("{{transcript_json}}", transcript_json)
    )


def write_workspace_json(corpus_id: str, payload: dict[str, Any]) -> None:
    out = workspace_path(corpus_id)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def backup_workspace(corpus_id: str, transcript: dict[str, Any], prefix: str = "pre_cleanup") -> Path:
    backup = json.loads(json.dumps(transcript, ensure_ascii=False))
    backup["snapshot_at"] = now_iso()
    out = snapshots_path(corpus_id) / f"{prefix}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    index = 1
    while out.exists():
        out = snapshots_path(corpus_id) / f"{prefix}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{index}.json"
        index += 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(backup, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


def same_timestamp(left: Any, right: Any) -> bool:
    try:
        return round(float(left), 3) == round(float(right), 3)
    except (TypeError, ValueError):
        return False


def validate_cleaned_transcript(
    current: dict[str, Any],
    cleaned: dict[str, Any],
    allow_empty_segments: bool = False,
) -> dict[str, int]:
    if not isinstance(cleaned, dict):
        raise SystemExit("Cleaned transcript must be a JSON object")
    if set(cleaned.keys()) != set(current.keys()):
        missing = sorted(set(current.keys()) - set(cleaned.keys()))
        extra = sorted(set(cleaned.keys()) - set(current.keys()))
        raise SystemExit(f"Top-level JSON keys changed. Missing={missing}, extra={extra}")

    for key in ["corpus_id", "audio_path", "source_transcript", "source_model", "project_instructions", "created_at", "updated_at"]:
        if key in current and cleaned.get(key) != current.get(key):
            raise SystemExit(f"Field changed unexpectedly: {key}")

    current_segments = current.get("segments")
    cleaned_segments = cleaned.get("segments")
    if not isinstance(current_segments, list) or not isinstance(cleaned_segments, list):
        raise SystemExit("Both transcripts must contain a segments list")
    if not cleaned_segments:
        raise SystemExit("Cleaned transcript has no segment")

    required_segment_keys = {"id", "start", "end", "text", "translation"}
    seen_ids = set()
    empty_segment_indexes = []
    previous_start = -1.0
    for index, segment in enumerate(cleaned_segments):
        if not isinstance(segment, dict):
            raise SystemExit(f"Segment {index} must be an object")
        if set(segment.keys()) != required_segment_keys:
            missing = sorted(required_segment_keys - set(segment.keys()))
            extra = sorted(set(segment.keys()) - required_segment_keys)
            raise SystemExit(f"Segment {index} keys changed. Missing={missing}, extra={extra}")
        segment_id = str(segment.get("id", "")).strip()
        if not segment_id:
            raise SystemExit(f"Segment {index} has an empty id")
        if segment_id in seen_ids:
            raise SystemExit(f"Duplicate segment id: {segment_id}")
        seen_ids.add(segment_id)
        try:
            start = float(segment["start"])
            end = float(segment["end"])
        except (TypeError, ValueError) as exc:
            raise SystemExit(f"Segment {index} has invalid timestamps") from exc
        if start < 0 or end < start:
            raise SystemExit(f"Segment {index} has inconsistent timestamps")
        if start < previous_start:
            raise SystemExit(f"Segment {index} starts before the previous segment")
        previous_start = start
        if not isinstance(segment.get("text"), str):
            raise SystemExit(f"Segment {index} text must be a string")
        if not allow_empty_segments and not segment["text"].strip():
            empty_segment_indexes.append(index)
        if not isinstance(segment.get("translation"), str):
            raise SystemExit(f"Segment {index} translation must be a string")
    if empty_segment_indexes:
        preview = ", ".join(str(index) for index in empty_segment_indexes[:12])
        suffix = "..." if len(empty_segment_indexes) > 12 else ""
        raise SystemExit(
            "Cleaned transcript still contains empty segment(s): "
            f"{preview}{suffix}. Remove empty/hallucinated segments before import."
        )

    before_by_id = {str(segment.get("id", "")): segment for segment in current_segments if isinstance(segment, dict)}
    after_by_id = {str(segment.get("id", "")): segment for segment in cleaned_segments}
    kept_ids = set(before_by_id) & set(after_by_id)
    return {
        "before": len(current_segments),
        "after": len(cleaned_segments),
        "added": len(set(after_by_id) - set(before_by_id)),
        "removed": len(set(before_by_id) - set(after_by_id)),
        "changed": sum(
            1
            for segment_id in kept_ids
            if str(before_by_id[segment_id].get("text", "")) != str(after_by_id[segment_id].get("text", ""))
        ),
    }


def read_pasted_text(end_marker: str = "EOF", cancel_marker: str = "CANCEL") -> str:
    if not sys.stdin.isatty():
        return sys.stdin.read()
    print(
        f"Colle le JSON nettoyé, puis termine par une ligne contenant uniquement {end_marker}.\n"
        f"Pour annuler, écris {cancel_marker} sur une ligne vide."
    )
    lines = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip() == end_marker:
            break
        if line.strip() == cancel_marker:
            raise SystemExit("Import cancelled")
        lines.append(line)
    return "\n".join(lines)


def read_from_clipboard() -> str:
    if sys.platform == "darwin":
        result = subprocess.run(["pbpaste"], text=True, capture_output=True, check=True)
        return result.stdout
    clipboard = subprocess.run(["which", "xclip"], text=True, capture_output=True, check=False)
    if clipboard.returncode == 0:
        result = subprocess.run(["xclip", "-selection", "clipboard", "-o"], text=True, capture_output=True, check=True)
        return result.stdout
    wl_clipboard = subprocess.run(["which", "wl-paste"], text=True, capture_output=True, check=False)
    if wl_clipboard.returncode == 0:
        result = subprocess.run(["wl-paste"], text=True, capture_output=True, check=True)
        return result.stdout
    raise SystemExit("No supported clipboard command found. Use --file or paste manually.")


def compact_preview(value: Any, width: int = 180) -> str:
    text = str(value or "").replace("\n", " ").strip()
    if len(text) <= width:
        return text
    return text[: width - 1] + "…"


def clipboard_review_lines(content: str) -> tuple[bool, list[str]]:
    lines = [f"Taille presse-papiers: {len(content)} caractères"]
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        lines.append(f"JSON invalide: {exc}")
        lines.append(f"Aperçu: {compact_preview(content)}")
        return False, lines

    if not isinstance(payload, dict):
        lines.append(f"JSON valide, mais type inattendu: {type(payload).__name__}")
        lines.append(f"Aperçu: {compact_preview(payload)}")
        return False, lines

    segments = payload.get("segments")
    lines.append(f"corpus_id: {payload.get('corpus_id', '<absent>')}")
    if not isinstance(segments, list):
        lines.append("segments: absent ou invalide")
        return False, lines
    lines.append(f"segments: {len(segments)}")
    if segments:
        first = segments[0] if isinstance(segments[0], dict) else {}
        last = segments[-1] if isinstance(segments[-1], dict) else {}
        lines.append(
            "premier: "
            f"{first.get('start', '?')} -> {first.get('end', '?')} · {compact_preview(first.get('text'))}"
        )
        lines.append(
            "dernier: "
            f"{last.get('start', '?')} -> {last.get('end', '?')} · {compact_preview(last.get('text'))}"
        )
    return True, lines


def read_clipboard_with_review() -> str:
    while True:
        content = read_from_clipboard()
        valid, lines = clipboard_review_lines(content)
        print("")
        print("=== Revue du presse-papiers ===")
        for line in lines:
            print(line)
        print("===============================")
        if not content.strip():
            choice = input("Le presse-papiers est vide. [r] recommencer, [n] annuler: ").strip().lower()
        elif valid:
            choice = input("Importer ce contenu ? [y] oui, [r] relire le presse-papiers, [n] annuler: ").strip().lower()
        else:
            choice = input("Ce contenu ne ressemble pas à une transcription complète. [r] recommencer, [n] annuler: ").strip().lower()
        if choice in {"y", "yes", "o", "oui"} and valid:
            return content
        if choice in {"r", "retry", "recommencer"}:
            continue
        raise SystemExit("Import cancelled")


def copy_to_clipboard(text: str) -> None:
    if sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=text, text=True, check=True)
        return
    clipboard = subprocess.run(["which", "xclip"], text=True, capture_output=True, check=False)
    if clipboard.returncode == 0:
        subprocess.run(["xclip", "-selection", "clipboard"], input=text, text=True, check=True)
        return
    raise SystemExit("No supported clipboard command found. Use --print to write the prompt to stdout.")


def read_cleaned_content(args: argparse.Namespace) -> str:
    if args.file:
        return Path(args.file).read_text(encoding="utf-8")
    if getattr(args, "clipboard", False):
        content = read_clipboard_with_review() if sys.stdin.isatty() else read_from_clipboard()
        if not content.strip():
            raise SystemExit("Clipboard is empty")
        return content
    return read_pasted_text()


def list_missing(_: argparse.Namespace) -> None:
    rows = read_manifest()
    missing = [row for row in rows if Path(row.get("audio_path", "")).as_posix() and not has_subtitle(row)]
    if not missing:
        print("All manifest videos have a local transcript/workspace.")
        return
    for row in missing:
        duration = row.get("duration_seconds")
        duration_text = f"{duration}s" if duration else "?s"
        print(f"{row['corpus_id']}\t{duration_text}\t{row.get('title', '')}")


def transcribe_one(row: dict[str, Any], force: bool = False) -> None:
    corpus_id = row["corpus_id"]
    if has_subtitle(row) and not force:
        print(f"[skip] {corpus_id}: transcript already exists")
        return

    if not ASR_PYTHON.exists():
        raise SystemExit(f"Missing ASR environment: {ASR_PYTHON}")
    if not Path(row.get("audio_path", "")).exists():
        raise SystemExit(f"Missing audio file for {corpus_id}: {row.get('audio_path')}")

    run(
        [
            str(ASR_PYTHON),
            "scripts/transcribe_mlx_whisper.py",
            "--manifest",
            str(MANIFEST.relative_to(ROOT)),
            "--model",
            LOCAL_WHISPER_MODEL,
            "--output-dir",
            str(LOCAL_WHISPER_DIR.relative_to(ROOT)),
            "--only",
            corpus_id,
        ]
    )
    workspace = write_workspace_from_whisper(row)
    print(f"[workspace] {workspace.relative_to(ROOT)}")


def transcribe_command(args: argparse.Namespace) -> None:
    transcribe_one(find_row(args.corpus_id), force=args.force)


def transcribe_missing(args: argparse.Namespace) -> None:
    rows = [row for row in read_manifest() if not has_subtitle(row)]
    if not rows:
        print("Nothing to transcribe.")
        return
    for row in rows:
        transcribe_one(row, force=args.force)


def copy_cleanup_prompt(args: argparse.Namespace) -> None:
    row = find_row(args.corpus_id)
    transcript = read_workspace_or_create(row)
    prompt_path = Path(args.prompt_file)
    if not prompt_path.is_absolute():
        prompt_path = ROOT / prompt_path
    prompt = render_cleanup_prompt(row, transcript, prompt_path)
    if args.print:
        print(prompt)
    if not args.no_copy:
        copy_to_clipboard(prompt)
        print(f"[clipboard] cleanup prompt for {args.corpus_id} ({len(prompt)} chars)")


def copy_cleanup_prompt_for_row(row: dict[str, Any]) -> int:
    transcript = read_workspace_or_create(row)
    prompt = render_cleanup_prompt(row, transcript, DEFAULT_CLEANUP_PROMPT)
    copy_to_clipboard(prompt)
    return len(prompt)


def import_cleaned_transcript(args: argparse.Namespace) -> None:
    row = find_row(args.corpus_id)
    current = read_workspace_or_create(row)
    content = read_cleaned_content(args)
    try:
        cleaned = json.loads(content)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON: {exc}") from exc

    summary = validate_cleaned_transcript(current, cleaned, allow_empty_segments=args.allow_empty_segments)
    backup = backup_workspace(args.corpus_id, current)
    write_workspace_json(args.corpus_id, cleaned)
    export_transcript_for_electron(row, workspace_path(args.corpus_id), "cleaned")
    print(f"[workspace] imported cleaned transcript: {workspace_path(args.corpus_id).relative_to(ROOT)}")
    print(f"[backup] previous transcript: {backup.relative_to(ROOT)}")
    print(
        "[segments] "
        f"{summary['before']} -> {summary['after']} "
        f"({summary['changed']} changed, {summary['added']} added, {summary['removed']} removed)"
    )


def youtube_cleanup_pipeline(args: argparse.Namespace) -> None:
    row = download_youtube(args)
    corpus_id = row["corpus_id"]

    if not has_subtitle(row) or args.force:
        transcribe_one(row, force=args.force)
    else:
        print(f"[skip] {corpus_id}: transcript already exists")

    copied_chars = copy_cleanup_prompt_for_row(row)
    print(f"[clipboard] cleanup prompt for {corpus_id} ({copied_chars} chars)")
    print("")
    print("Étape suivante:")
    print("1. Colle le presse-papiers dans ChatGPT.")
    print("2. Copie uniquement le JSON complet renvoyé par ChatGPT.")
    print("3. Reviens ici avec ce JSON dans le presse-papiers.")
    print("")

    if sys.stdin.isatty():
        input("Quand le JSON nettoyé est copié, appuie sur Entrée pour l'importer depuis le presse-papiers...")
    import_args = argparse.Namespace(corpus_id=corpus_id, file=None, clipboard=sys.stdin.isatty(), allow_empty_segments=False)
    import_cleaned_transcript(import_args)


def duration_label(seconds: Any) -> str:
    if not seconds:
        return "?m"
    total = int(seconds)
    minutes = total // 60
    secs = total % 60
    return f"{minutes}:{secs:02d}"


def transcript_status(row: dict[str, Any]) -> str:
    corpus_id = row["corpus_id"]
    if workspace_path(corpus_id).exists():
        return "workspace"
    if autosave_path(corpus_id).exists():
        return "autosave"
    if whisper_json_path(corpus_id).exists():
        return "whisper"
    return "missing"


def short(value: str, width: int) -> str:
    value = value.replace("\n", " ").strip()
    if len(value) <= width:
        return value
    return value[: max(0, width - 1)] + "…"


def tui_choice(stdscr: Any, title: str, items: list[tuple[str, Any]]) -> Any | None:
    import curses

    index = 0
    offset = 0
    while True:
        height, width = stdscr.getmaxyx()
        visible = max(1, height - 5)
        if index < offset:
            offset = index
        if index >= offset + visible:
            offset = index - visible + 1

        stdscr.erase()
        stdscr.addstr(0, 0, short(title, width - 1), curses.A_BOLD)
        stdscr.addstr(1, 0, "↑/↓ choisir · Entrée valider · q retour", curses.A_DIM)
        for screen_row, (label, _value) in enumerate(items[offset : offset + visible], start=3):
            item_index = offset + screen_row - 3
            marker = "› " if item_index == index else "  "
            attr = curses.A_REVERSE if item_index == index else curses.A_NORMAL
            stdscr.addstr(screen_row, 0, short(marker + label, width - 1), attr)
        stdscr.refresh()

        key = stdscr.getch()
        if key in {ord("q"), 27}:
            return None
        if key in {curses.KEY_UP, ord("k")}:
            index = max(0, index - 1)
        elif key in {curses.KEY_DOWN, ord("j")}:
            index = min(len(items) - 1, index + 1)
        elif key in {10, 13, curses.KEY_ENTER}:
            return items[index][1]


def tui_message(stdscr: Any, lines: list[str]) -> None:
    import curses

    stdscr.erase()
    height, width = stdscr.getmaxyx()
    for row, line in enumerate(lines[: height - 2]):
        stdscr.addstr(row, 0, short(line, width - 1))
    stdscr.addstr(height - 1, 0, "Entrée pour continuer", curses.A_DIM)
    stdscr.refresh()
    while stdscr.getch() not in {10, 13, curses.KEY_ENTER}:
        pass


def tui_confirm(stdscr: Any, question: str) -> bool:
    import curses

    stdscr.erase()
    stdscr.addstr(0, 0, question, curses.A_BOLD)
    stdscr.addstr(2, 0, "y confirmer · n annuler", curses.A_DIM)
    stdscr.refresh()
    while True:
        key = stdscr.getch()
        if key in {ord("y"), ord("Y"), ord("o"), ord("O")}:
            return True
        if key in {ord("n"), ord("N"), ord("q"), 27}:
            return False


def tui_input(stdscr: Any, label: str, default: str = "") -> str:
    import curses

    buffer = list(default)
    cursor = len(buffer)
    insert_mode = True
    curses.curs_set(1)
    stdscr.keypad(True)
    try:
        while True:
            height, width = stdscr.getmaxyx()
            field_width = max(8, width - 4)
            start = max(0, min(cursor - field_width + 1, max(0, len(buffer) - field_width)))
            visible = "".join(buffer[start : start + field_width])
            mode = "INSERT" if insert_mode else "NORMAL"

            stdscr.erase()
            stdscr.addstr(0, 0, short(label, width - 1), curses.A_BOLD)
            stdscr.addstr(1, 0, short(f"Mode {mode} · Entrée valider · Ctrl+C annuler", width - 1), curses.A_DIM)
            stdscr.addstr(2, 0, short("Insert: flèches/backspace/delete · Normal: h/l/0/$/x/i/a/A/I/q", width - 1), curses.A_DIM)
            stdscr.addstr(4, 0, "> ")
            stdscr.addstr(4, 2, visible)
            stdscr.move(4, 2 + max(0, cursor - start))
            stdscr.refresh()

            key = stdscr.get_wch()
            if key == "\n":
                return "".join(buffer).strip()
            if key == "\x03":
                return ""
            if isinstance(key, str) and key == "\x1b":
                if insert_mode:
                    insert_mode = False
                    cursor = max(0, min(cursor, len(buffer)))
                else:
                    return ""
                continue

            if insert_mode:
                if key in {curses.KEY_LEFT, "\x02"}:
                    cursor = max(0, cursor - 1)
                elif key in {curses.KEY_RIGHT, "\x06"}:
                    cursor = min(len(buffer), cursor + 1)
                elif key in {curses.KEY_HOME, "\x01"}:
                    cursor = 0
                elif key in {curses.KEY_END, "\x05"}:
                    cursor = len(buffer)
                elif key in {curses.KEY_BACKSPACE, "\b", "\x7f"}:
                    if cursor > 0:
                        del buffer[cursor - 1]
                        cursor -= 1
                elif key == curses.KEY_DC:
                    if cursor < len(buffer):
                        del buffer[cursor]
                elif isinstance(key, str) and key.isprintable():
                    buffer.insert(cursor, key)
                    cursor += 1
                continue

            if key in {curses.KEY_LEFT, "h"}:
                cursor = max(0, cursor - 1)
            elif key in {curses.KEY_RIGHT, "l"}:
                cursor = min(len(buffer), cursor + 1)
            elif key in {curses.KEY_HOME, "0"}:
                cursor = 0
            elif key in {curses.KEY_END, "$"}:
                cursor = len(buffer)
            elif key == "x":
                if cursor < len(buffer):
                    del buffer[cursor]
            elif key == "i":
                insert_mode = True
            elif key == "a":
                cursor = min(len(buffer), cursor + 1)
                insert_mode = True
            elif key == "A":
                cursor = len(buffer)
                insert_mode = True
            elif key == "I":
                cursor = 0
                insert_mode = True
            elif key in {"q", "Q"}:
                return ""
    finally:
        curses.curs_set(0)


def tui_run_shell(stdscr: Any, action: Any) -> None:
    import curses

    curses.def_prog_mode()
    curses.endwin()
    try:
        action()
    except SystemExit as exc:
        print(f"\n[error] {exc}")
    except subprocess.CalledProcessError as exc:
        print(f"\n[error] command exited with code {exc.returncode}")
    finally:
        input("\nEntrée pour revenir au TUI...")
        curses.reset_prog_mode()
        stdscr.clear()


def tui_video_items(rows: list[dict[str, Any]]) -> list[tuple[str, dict[str, Any]]]:
    return [
        (
            f"{row['corpus_id']} · {duration_label(row.get('duration_seconds'))} · {transcript_status(row)} · "
            f"{row.get('title', '')}",
            row,
        )
        for row in rows
    ]


def tui_guided_youtube_pipeline(stdscr: Any) -> None:
    import curses

    url = tui_input(stdscr, "URL YouTube")
    if not url:
        return

    stdscr.erase()
    stdscr.addstr(0, 0, "Analyse du titre YouTube...", curses.A_BOLD)
    stdscr.refresh()
    try:
        info = yt_dlp_json(url)
    except (subprocess.CalledProcessError, SystemExit) as exc:
        tui_message(stdscr, [f"Impossible de lire les métadonnées YouTube: {exc}"])
        return
    title = str(info.get("title") or youtube_id_from_info(info))
    export_label = tui_input(
        stdscr,
        "Libellé court du dossier de transcription",
        default_export_label(title),
    )

    use_defaults = tui_confirm(stdscr, "Utiliser les paramètres par défaut ?")
    if use_defaults:
        corpus_id = ""
        speaker = ""
        series = "YouTube imports"
    else:
        corpus_id = tui_input(stdscr, "corpus_id optionnel")
        speaker = tui_input(stdscr, "Speaker optionnel")
        series = tui_input(stdscr, "Série optionnelle", "YouTube imports")

    args = argparse.Namespace(
        url=url,
        corpus_id=corpus_id or None,
        speaker=speaker or None,
        series=series or None,
        export_label=export_label or None,
        force=False,
    )
    tui_run_shell(stdscr, lambda: youtube_cleanup_pipeline(args))


def run_tui(_: argparse.Namespace) -> None:
    import curses

    def app(stdscr: Any) -> None:
        curses.curs_set(0)
        stdscr.keypad(True)
        while True:
            action = tui_choice(
                stdscr,
                "Tarjama Studio CLI",
                [
                    ("Nouvelle vidéo complète: télécharger -> transcrire -> nettoyer", "guided_youtube"),
                    ("Deprecated · Lister les vidéos sans transcription", "missing"),
                    ("Deprecated · Transcrire une vidéo", "transcribe_one"),
                    ("Deprecated · Transcrire tout ce qui manque", "transcribe_missing"),
                    ("Deprecated · Télécharger une vidéo YouTube seule", "download"),
                    ("Deprecated · Copier un prompt de nettoyage seul", "cleanup_prompt"),
                    ("Deprecated · Coller une transcription nettoyée seule", "import_cleaned"),
                    ("Quitter", "quit"),
                ],
            )
            if action in {None, "quit"}:
                return
            if action == "guided_youtube":
                tui_guided_youtube_pipeline(stdscr)
            elif action == "missing":
                rows = read_manifest()
                missing = [row for row in rows if Path(row.get("audio_path", "")).as_posix() and not has_subtitle(row)]
                if not missing:
                    tui_message(stdscr, ["Toutes les vidéos du manifest ont une transcription locale ou un workspace."])
                else:
                    selected = tui_choice(stdscr, "Vidéos sans transcription", tui_video_items(missing))
                    if selected and tui_confirm(stdscr, f"Transcrire {selected['corpus_id']} maintenant ?"):
                        tui_run_shell(stdscr, lambda row=selected: transcribe_one(row))
            elif action == "transcribe_one":
                rows = read_manifest()
                selected = tui_choice(stdscr, "Choisir une vidéo à transcrire", tui_video_items(rows))
                if selected:
                    force = has_subtitle(selected) and tui_confirm(
                        stdscr,
                        f"{selected['corpus_id']} a déjà une transcription. Forcer le remplacement ?",
                    )
                    if not has_subtitle(selected) or force:
                        tui_run_shell(stdscr, lambda row=selected, force=force: transcribe_one(row, force=force))
            elif action == "transcribe_missing":
                if tui_confirm(stdscr, "Lancer Whisper sur toutes les vidéos manquantes ?"):
                    args = argparse.Namespace(force=False)
                    tui_run_shell(stdscr, lambda: transcribe_missing(args))
            elif action == "download":
                url = tui_input(stdscr, "URL YouTube")
                if not url:
                    continue
                corpus_id = tui_input(stdscr, "corpus_id optionnel")
                speaker = tui_input(stdscr, "Speaker optionnel")
                series = tui_input(stdscr, "Série optionnelle", "YouTube imports")
                transcribe = tui_confirm(stdscr, "Transcrire automatiquement après téléchargement ?")
                args = argparse.Namespace(
                    url=url,
                    corpus_id=corpus_id or None,
                    speaker=speaker or None,
                    series=series or None,
                    export_label=None,
                    transcribe=transcribe,
                    force=False,
                )
                tui_run_shell(stdscr, lambda: download_command(args))
            elif action == "cleanup_prompt":
                rows = [row for row in read_manifest() if has_subtitle(row)]
                selected = tui_choice(stdscr, "Choisir une transcription à nettoyer", tui_video_items(rows))
                if selected:
                    try:
                        copied_chars = copy_cleanup_prompt_for_row(selected)
                    except SystemExit as exc:
                        tui_message(stdscr, [f"Erreur: {exc}"])
                        continue
                    if tui_confirm(
                        stdscr,
                        f"Prompt copié ({copied_chars} caractères). Lire le JSON nettoyé depuis le presse-papiers maintenant ?",
                    ):
                        args = argparse.Namespace(
                            corpus_id=selected["corpus_id"],
                            file=None,
                            clipboard=True,
                            allow_empty_segments=False,
                        )
                        tui_run_shell(stdscr, lambda: import_cleaned_transcript(args))
            elif action == "import_cleaned":
                rows = [row for row in read_manifest() if has_subtitle(row)]
                selected = tui_choice(stdscr, "Choisir la transcription à remplacer", tui_video_items(rows))
                if selected:
                    use_clipboard = tui_confirm(stdscr, "Lire le JSON nettoyé depuis le presse-papiers ?")
                    args = argparse.Namespace(
                        corpus_id=selected["corpus_id"],
                        file=None,
                        clipboard=use_clipboard,
                        allow_empty_segments=False,
                    )
                    tui_run_shell(stdscr, lambda: import_cleaned_transcript(args))

    curses.wrapper(app)


def yt_dlp_json(url: str) -> dict[str, Any]:
    if not YTDLP.exists():
        raise SystemExit(f"Missing yt-dlp: {YTDLP}")
    result = subprocess.run([str(YTDLP), "-J", url], cwd=ROOT, text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def media_streams(path: Path) -> tuple[bool, bool]:
    result = subprocess.run(
        [str(FFMPEG), "-hide_banner", "-i", str(path)],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    output = result.stdout
    return " Video:" in output, " Audio:" in output


def downloaded_media_candidates(video_dir: Path, corpus_id: str) -> list[Path]:
    ignored_suffixes = {".json", ".description", ".part", ".ytdl"}
    return sorted(
        path
        for path in video_dir.glob(f"{corpus_id}.*")
        if path.is_file() and path.suffix not in ignored_suffixes
    )


def resolve_downloaded_video(video_dir: Path, corpus_id: str) -> Path:
    merged = video_dir / f"{corpus_id}.mp4"
    if merged.exists() and media_streams(merged) == (True, True):
        return merged

    video_only = []
    audio_only = []
    for candidate in downloaded_media_candidates(video_dir, corpus_id):
        has_video, has_audio = media_streams(candidate)
        if has_video and has_audio:
            return candidate
        if has_video:
            video_only.append(candidate)
        elif has_audio:
            audio_only.append(candidate)

    if not video_only:
        raise SystemExit(f"Could not find a video stream in {video_dir}")
    if not audio_only:
        raise SystemExit(f"Could not find an audio stream in {video_dir}")

    run(
        [
            str(FFMPEG),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video_only[0]),
            "-i",
            str(audio_only[0]),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "22",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(merged),
        ]
    )
    return merged


def ensure_row_has_playable_video(row: dict[str, Any]) -> dict[str, Any]:
    corpus_id = row["corpus_id"]
    current_value = row.get("video_path")
    if current_value:
        current_path = ROOT / current_value
        if current_path.exists() and media_streams(current_path) == (True, True):
            return row

    if current_value:
        video_dir = (ROOT / current_value).parent
    else:
        video_dir = ROOT / "data/raw/videos/youtube" / corpus_id
    fixed_path = resolve_downloaded_video(video_dir, corpus_id)
    row["video_path"] = str(fixed_path.relative_to(ROOT))
    replace_manifest_row(row)
    print(f"[manifest] repaired video_path for {corpus_id}: {row['video_path']}")
    return row


def download_youtube(args: argparse.Namespace) -> dict[str, Any]:
    info = yt_dlp_json(args.url)
    video_id = youtube_id_from_info(info)
    existing = [row for row in read_manifest() if row.get("youtube_id") == video_id]
    if existing:
        export_label = getattr(args, "export_label", None)
        if export_label and existing[0].get("export_label") != export_label:
            existing[0]["export_label"] = export_label
            replace_manifest_row(existing[0])
        print(f"[exists] {existing[0]['corpus_id']}")
        return ensure_row_has_playable_video(existing[0])

    title = str(info.get("title") or video_id)
    export_label = getattr(args, "export_label", None) or default_export_label(title)
    corpus_id = args.corpus_id or f"youtube_{video_id}"
    corpus_id = slugify(corpus_id)
    video_dir = ROOT / "data/raw/videos/youtube" / corpus_id
    audio_dir = ROOT / "data/raw/audio/youtube" / corpus_id
    video_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)

    output_template = str(video_dir / f"{corpus_id}.%(ext)s")
    run(
        [
            str(YTDLP),
            "--ffmpeg-location",
            str(FFMPEG.parent),
            "-f",
            "bv*[ext=mp4]+ba/best",
            "--merge-output-format",
            "mp4",
            "--write-info-json",
            "--write-description",
            "-o",
            output_template,
            args.url,
        ]
    )

    video_path = resolve_downloaded_video(video_dir, corpus_id)

    audio_path = audio_dir / f"{corpus_id}.wav"
    run(
        [
            str(FFMPEG),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video_path),
            "-ac",
            "1",
            "-ar",
            "16000",
            str(audio_path),
        ]
    )

    row = {
        "corpus_id": corpus_id,
        "speaker": args.speaker,
        "series": args.series or "YouTube imports",
        "episode": None,
        "language": "ar",
        "youtube_id": video_id,
        "youtube_url": info.get("webpage_url") or args.url,
        "export_label": export_label,
        "title": title,
        "channel": info.get("channel") or info.get("uploader"),
        "upload_date": info.get("upload_date"),
        "duration_seconds": info.get("duration"),
        "video_path": str(video_path.relative_to(ROOT)),
        "audio_path": str(audio_path.relative_to(ROOT)),
        "transcript_docx_path": None,
        "transcript_txt_path": None,
        "transcript_source_url": None,
        "transcript_type": "generated_whisper_local",
        "validation_note": "Downloaded from YouTube via Tarjama Studio CLI; local Whisper transcription may be generated separately.",
    }
    append_manifest(row)
    row = ensure_row_has_playable_video(row)
    print(f"[manifest] {corpus_id}")
    return row


def download_command(args: argparse.Namespace) -> None:
    row = download_youtube(args)
    if args.transcribe:
        transcribe_one(row, force=args.force)


def main() -> None:
    parser = argparse.ArgumentParser(description="Tarjama Studio local transcription CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    missing = sub.add_parser("list-missing", help="List manifest videos without a local transcript/workspace")
    missing.set_defaults(func=list_missing)

    one = sub.add_parser("transcribe", help="Transcribe one manifest video by corpus_id")
    one.add_argument("corpus_id")
    one.add_argument("--force", action="store_true")
    one.set_defaults(func=transcribe_command)

    all_missing = sub.add_parser("transcribe-missing", help="Transcribe all manifest videos without transcript/workspace")
    all_missing.add_argument("--force", action="store_true")
    all_missing.set_defaults(func=transcribe_missing)

    cleanup = sub.add_parser("copy-cleanup-prompt", help="Copy a ChatGPT cleanup prompt plus transcript JSON")
    cleanup.add_argument("corpus_id")
    cleanup.add_argument("--prompt-file", default=str(DEFAULT_CLEANUP_PROMPT.relative_to(ROOT)))
    cleanup.add_argument("--print", action="store_true", help="Also print the generated prompt to stdout")
    cleanup.add_argument("--no-copy", action="store_true", help="Do not copy to clipboard")
    cleanup.set_defaults(func=copy_cleanup_prompt)

    import_cleaned = sub.add_parser("import-cleaned-transcript", help="Import cleaned workspace JSON from a file or paste")
    import_cleaned.add_argument("corpus_id")
    import_cleaned.add_argument("--file", help="Read cleaned JSON from a file instead of stdin/paste")
    import_cleaned.add_argument("--clipboard", action="store_true", help="Read cleaned JSON from the clipboard")
    import_cleaned.add_argument("--allow-empty-segments", action="store_true", help="Import even if some cleaned segments have empty text")
    import_cleaned.set_defaults(func=import_cleaned_transcript)

    tui = sub.add_parser("tui", help="Open an interactive terminal UI")
    tui.set_defaults(func=run_tui)

    menu = sub.add_parser("menu", help="Alias for tui")
    menu.set_defaults(func=run_tui)

    download = sub.add_parser("download", help="Download a YouTube URL into the corpus")
    download.add_argument("url")
    download.add_argument("--corpus-id")
    download.add_argument("--speaker")
    download.add_argument("--series")
    download.add_argument("--export-label", help="Short Latin label used for exports/transcriptions/<corpus_id>__<label>")
    download.add_argument("--transcribe", action="store_true", help="Run local Whisper after download")
    download.add_argument("--force", action="store_true")
    download.set_defaults(func=download_command)

    pipeline = sub.add_parser(
        "youtube-pipeline",
        help="Download a YouTube URL, transcribe it, copy cleanup prompt, then import cleaned JSON",
    )
    pipeline.add_argument("url")
    pipeline.add_argument("--corpus-id")
    pipeline.add_argument("--speaker")
    pipeline.add_argument("--series")
    pipeline.add_argument("--export-label", help="Short Latin label used for exports/transcriptions/<corpus_id>__<label>")
    pipeline.add_argument("--force", action="store_true")
    pipeline.set_defaults(func=youtube_cleanup_pipeline)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
