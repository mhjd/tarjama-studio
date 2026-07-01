#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data/manifests/dedew_manifest.jsonl"
WORKSPACES = ROOT / "data/workspaces"
LOCAL_WHISPER_DIR = ROOT / "data/model_outputs/whisper_large_v3_mlx"
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


def has_subtitle(row: dict[str, Any]) -> bool:
    corpus_id = row["corpus_id"]
    return workspace_path(corpus_id).exists() or autosave_path(corpus_id).exists() or whisper_json_path(corpus_id).exists()


def slugify(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9]+", "_", value.strip()).strip("_").lower()
    return value or "video"


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


def read_pasted_text(end_marker: str = "EOF") -> str:
    if not sys.stdin.isatty():
        return sys.stdin.read()
    print(f"Colle le JSON nettoyé, puis termine par une ligne contenant uniquement {end_marker}.")
    lines = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip() == end_marker:
            break
        lines.append(line)
    return "\n".join(lines)


def copy_to_clipboard(text: str) -> None:
    if sys.platform == "darwin":
        subprocess.run(["pbcopy"], input=text, text=True, check=True)
        return
    clipboard = subprocess.run(["which", "xclip"], text=True, capture_output=True, check=False)
    if clipboard.returncode == 0:
        subprocess.run(["xclip", "-selection", "clipboard"], input=text, text=True, check=True)
        return
    raise SystemExit("No supported clipboard command found. Use --print to write the prompt to stdout.")


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
    if args.file:
        content = Path(args.file).read_text(encoding="utf-8")
    else:
        content = read_pasted_text()
    try:
        cleaned = json.loads(content)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON: {exc}") from exc

    summary = validate_cleaned_transcript(current, cleaned, allow_empty_segments=args.allow_empty_segments)
    backup = backup_workspace(args.corpus_id, current)
    write_workspace_json(args.corpus_id, cleaned)
    print(f"[workspace] imported cleaned transcript: {workspace_path(args.corpus_id).relative_to(ROOT)}")
    print(f"[backup] previous transcript: {backup.relative_to(ROOT)}")
    print(
        "[segments] "
        f"{summary['before']} -> {summary['after']} "
        f"({summary['changed']} changed, {summary['added']} added, {summary['removed']} removed)"
    )


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

    stdscr.erase()
    stdscr.addstr(0, 0, label, curses.A_BOLD)
    if default:
        stdscr.addstr(1, 0, f"Défaut: {default}", curses.A_DIM)
    stdscr.addstr(3, 0, "> ")
    curses.echo()
    try:
        raw = stdscr.getstr(3, 2, 500)
    finally:
        curses.noecho()
    value = raw.decode("utf-8").strip()
    return value or default


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


def run_tui(_: argparse.Namespace) -> None:
    import curses

    def app(stdscr: Any) -> None:
        curses.curs_set(0)
        stdscr.keypad(True)
        while True:
            action = tui_choice(
                stdscr,
                "Ashrafent CLI",
                [
                    ("Lister les vidéos sans transcription", "missing"),
                    ("Transcrire une vidéo", "transcribe_one"),
                    ("Transcrire tout ce qui manque", "transcribe_missing"),
                    ("Télécharger une vidéo YouTube", "download"),
                    ("Copier un prompt de nettoyage", "cleanup_prompt"),
                    ("Coller une transcription nettoyée", "import_cleaned"),
                    ("Quitter", "quit"),
                ],
            )
            if action in {None, "quit"}:
                return
            if action == "missing":
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
                        f"Prompt copié ({copied_chars} caractères). Coller le JSON nettoyé maintenant ?",
                    ):
                        args = argparse.Namespace(
                            corpus_id=selected["corpus_id"],
                            file=None,
                            allow_empty_segments=False,
                        )
                        tui_run_shell(stdscr, lambda: import_cleaned_transcript(args))
            elif action == "import_cleaned":
                rows = [row for row in read_manifest() if has_subtitle(row)]
                selected = tui_choice(stdscr, "Choisir la transcription à remplacer", tui_video_items(rows))
                if selected:
                    args = argparse.Namespace(corpus_id=selected["corpus_id"], file=None, allow_empty_segments=False)
                    tui_run_shell(stdscr, lambda: import_cleaned_transcript(args))

    curses.wrapper(app)


def yt_dlp_json(url: str) -> dict[str, Any]:
    if not YTDLP.exists():
        raise SystemExit(f"Missing yt-dlp: {YTDLP}")
    result = subprocess.run([str(YTDLP), "-J", url], cwd=ROOT, text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


def download_youtube(args: argparse.Namespace) -> dict[str, Any]:
    info = yt_dlp_json(args.url)
    video_id = youtube_id_from_info(info)
    existing = [row for row in read_manifest() if row.get("youtube_id") == video_id]
    if existing:
        print(f"[exists] {existing[0]['corpus_id']}")
        return existing[0]

    title = str(info.get("title") or video_id)
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

    video_path = video_dir / f"{corpus_id}.mp4"
    if not video_path.exists():
        candidates = sorted(video_dir.glob(f"{corpus_id}.*"))
        candidates = [path for path in candidates if path.suffix not in {".json", ".description"}]
        if not candidates:
            raise SystemExit(f"Could not find downloaded media in {video_dir}")
        video_path = candidates[0]

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
        "validation_note": "Downloaded from YouTube via ashrafent CLI; local Whisper transcription may be generated separately.",
    }
    append_manifest(row)
    print(f"[manifest] {corpus_id}")
    return row


def download_command(args: argparse.Namespace) -> None:
    row = download_youtube(args)
    if args.transcribe:
        transcribe_one(row, force=args.force)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ashrafent local transcription CLI")
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
    download.add_argument("--transcribe", action="store_true", help="Run local Whisper after download")
    download.add_argument("--force", action="store_true")
    download.set_defaults(func=download_command)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
