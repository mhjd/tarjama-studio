from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data/manifests/dedew_manifest.jsonl"
WORKSPACES = ROOT / "data/workspaces"
LOCAL_WHISPER_DIR = ROOT / "data/model_outputs/whisper_large_v3_mlx"
EXPORTS = ROOT / "exports"
IMAGEIO_FFMPEG = ROOT / ".venv/lib/python3.14/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1"
EXPORT_JOBS: dict[str, dict[str, Any]] = {}

app = FastAPI(title="Ashrafent Local MVP")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TranscriptSave(BaseModel):
    transcript: dict[str, Any]


class SnapshotSave(BaseModel):
    transcript: dict[str, Any] | None = None


class SnapshotInfo(BaseModel):
    id: str
    created_at: str | None
    segment_count: int
    matches_current: bool = False


class TranslationImport(BaseModel):
    content: str
    filename: str | None = None
    language: str = "fr"
    replace: bool = False


class TranslationSave(BaseModel):
    translation: dict[str, Any]


class VideoExportRequest(BaseModel):
    track: str = "translation"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def filename_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def read_manifest() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not MANIFEST.exists():
        return rows
    with MANIFEST.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def find_video(corpus_id: str) -> dict[str, Any]:
    for row in read_manifest():
        if row.get("corpus_id") == corpus_id:
            return row
    raise HTTPException(status_code=404, detail="Unknown corpus_id")


def safe_path(relative_or_absolute: str | Path) -> Path:
    path = Path(relative_or_absolute)
    if not path.is_absolute():
        path = ROOT / path
    path = path.resolve()
    if ROOT not in path.parents and path != ROOT:
        raise HTTPException(status_code=400, detail="Path escapes project root")
    return path


def workspace_dir(corpus_id: str) -> Path:
    return WORKSPACES / corpus_id


def transcript_path(corpus_id: str) -> Path:
    return workspace_dir(corpus_id) / "transcript.json"


def autosave_path(corpus_id: str) -> Path:
    return workspace_dir(corpus_id) / "autosave.json"


def snapshots_dir(corpus_id: str) -> Path:
    return workspace_dir(corpus_id) / "snapshots"


def translation_path(corpus_id: str) -> Path:
    return workspace_dir(corpus_id) / "translation.json"


def translation_snapshots_dir(corpus_id: str) -> Path:
    return workspace_dir(corpus_id) / "translation_snapshots"


def local_whisper_path(corpus_id: str) -> Path:
    return LOCAL_WHISPER_DIR / f"{corpus_id}.json"


def snapshot_paths(corpus_id: str) -> list[Path]:
    path = snapshots_dir(corpus_id)
    if not path.exists():
        return []
    return sorted(path.glob("*.json"), key=lambda item: item.stat().st_mtime_ns)


def user_snapshot_paths(corpus_id: str) -> list[Path]:
    return [
        path
        for path in snapshot_paths(corpus_id)
        if not path.name.startswith(("legacy_autosave_", "pre_restore_", "pre_cleanup_"))
    ]


def latest_snapshot_path(corpus_id: str) -> Path | None:
    paths = user_snapshot_paths(corpus_id)
    return paths[-1] if paths else None


def user_snapshot_path(corpus_id: str, snapshot_id: str) -> Path:
    matches = [path for path in user_snapshot_paths(corpus_id) if path.name == snapshot_id]
    if not matches:
        raise HTTPException(status_code=404, detail="Unknown snapshot")
    return matches[0]


def transcript_fingerprint(transcript: dict[str, Any] | None) -> str:
    if not transcript:
        return ""
    comparable = {
        "project_instructions": transcript.get("project_instructions", ""),
        "segments": [
            {
                "id": str(segment.get("id", "")),
                "start": float(segment.get("start", 0.0)),
                "end": float(segment.get("end", 0.0)),
                "text": str(segment.get("text", "")),
            }
            for segment in transcript.get("segments", [])
        ],
    }
    return json.dumps(comparable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def transcripts_differ(left: dict[str, Any] | None, right: dict[str, Any] | None) -> bool:
    return transcript_fingerprint(left) != transcript_fingerprint(right)


def transcript_alignment_fingerprint(transcript: dict[str, Any]) -> str:
    comparable = [
        {
            "id": str(segment.get("id", "")),
            "start": round(float(segment.get("start", 0.0)), 3),
            "end": round(float(segment.get("end", 0.0)), 3),
        }
        for segment in transcript.get("segments", [])
    ]
    return json.dumps(comparable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def public_video(row: dict[str, Any]) -> dict[str, Any]:
    corpus_id = row["corpus_id"]
    audio_path = row.get("audio_path")
    video_path = row.get("video_path")
    return {
        "corpus_id": corpus_id,
        "title": row.get("title") or corpus_id,
        "speaker": row.get("speaker"),
        "series": row.get("series"),
        "episode": row.get("episode"),
        "duration_seconds": row.get("duration_seconds"),
        "audio_url": f"/media/{audio_path}" if audio_path else None,
        "has_video": bool(video_path and safe_path(video_path).exists()),
        "has_workspace": transcript_path(corpus_id).exists(),
        "has_autosave": autosave_path(corpus_id).exists(),
        "has_snapshot": latest_snapshot_path(corpus_id) is not None,
        "has_model_transcript": local_whisper_path(corpus_id).exists(),
    }


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def workspace_from_whisper(row: dict[str, Any], source_path: Path) -> dict[str, Any]:
    raw = read_json(source_path)
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
    return {
        "corpus_id": row["corpus_id"],
        "audio_path": row.get("audio_path"),
        "source_transcript": str(source_path.relative_to(ROOT)),
        "source_model": raw.get("model"),
        "project_instructions": "",
        "segments": segments,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }


def write_snapshot(corpus_id: str, transcript: dict[str, Any], prefix: str = "save") -> Path:
    snapshot = json.loads(json.dumps(transcript, ensure_ascii=False))
    snapshot["corpus_id"] = corpus_id
    snapshot["snapshot_at"] = now_iso()
    out = snapshots_dir(corpus_id) / f"{prefix}_{filename_timestamp()}.json"
    index = 1
    while out.exists():
        out = snapshots_dir(corpus_id) / f"{prefix}_{filename_timestamp()}_{index}.json"
        index += 1
    write_json(out, snapshot)
    return out


def write_translation_snapshot(corpus_id: str, translation: dict[str, Any], prefix: str = "save") -> Path:
    snapshot = json.loads(json.dumps(translation, ensure_ascii=False))
    snapshot["corpus_id"] = corpus_id
    snapshot["snapshot_at"] = now_iso()
    out = translation_snapshots_dir(corpus_id) / f"{prefix}_{filename_timestamp()}.json"
    index = 1
    while out.exists():
        out = translation_snapshots_dir(corpus_id) / f"{prefix}_{filename_timestamp()}_{index}.json"
        index += 1
    write_json(out, snapshot)
    return out


def ensure_baseline_snapshot(corpus_id: str) -> None:
    saved = transcript_path(corpus_id)
    if saved.exists() and latest_snapshot_path(corpus_id) is None:
        write_snapshot(corpus_id, read_json(saved), "initial")


def migrate_legacy_autosave(corpus_id: str) -> None:
    legacy = autosave_path(corpus_id)
    if not legacy.exists():
        return
    ensure_baseline_snapshot(corpus_id)
    current = read_json(legacy)
    current["corpus_id"] = corpus_id
    current["updated_at"] = now_iso()
    write_json(transcript_path(corpus_id), current)
    archived = snapshots_dir(corpus_id) / f"legacy_autosave_{filename_timestamp()}.json"
    archived.parent.mkdir(parents=True, exist_ok=True)
    index = 1
    while archived.exists():
        archived = snapshots_dir(corpus_id) / f"legacy_autosave_{filename_timestamp()}_{index}.json"
        index += 1
    legacy.replace(archived)


def load_best_transcript(corpus_id: str) -> dict[str, Any] | None:
    migrate_legacy_autosave(corpus_id)
    saved = transcript_path(corpus_id)
    if saved.exists():
        ensure_baseline_snapshot(corpus_id)
        return read_json(saved)
    return None


def recovery_state(corpus_id: str) -> dict[str, Any]:
    current = load_best_transcript(corpus_id)
    latest = latest_snapshot_path(corpus_id)
    snapshot = read_json(latest) if latest else None
    return {
        "needs_resolution": bool(current and snapshot and transcripts_differ(current, snapshot)),
        "snapshot_path": str(latest.relative_to(ROOT)) if latest else None,
        "snapshot": snapshot,
    }


def snapshot_info(path: Path, current: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = read_json(path)
    created_at = payload.get("snapshot_at") or payload.get("updated_at") or payload.get("created_at")
    return {
        "id": path.name,
        "created_at": created_at,
        "segment_count": len(payload.get("segments", [])),
        "matches_current": bool(current and not transcripts_differ(current, payload)),
    }


def restore_snapshot_file(corpus_id: str, snapshot_path: Path) -> dict[str, Any]:
    current = load_best_transcript(corpus_id)
    latest = latest_snapshot_path(corpus_id)
    snapshot = read_json(snapshot_path)
    if current and transcripts_differ(current, snapshot):
        write_snapshot(corpus_id, current, "pre_restore")
    snapshot["corpus_id"] = corpus_id
    snapshot["updated_at"] = now_iso()
    snapshot.pop("snapshot_at", None)
    write_json(transcript_path(corpus_id), snapshot)
    if latest is None or latest.name != snapshot_path.name:
        write_snapshot(corpus_id, snapshot, "restore")
    return {"ok": True, "transcript": snapshot, "recovery": recovery_state(corpus_id)}


def ensure_transcript(corpus_id: str) -> dict[str, Any]:
    existing = load_best_transcript(corpus_id)
    if existing:
        return existing

    row = find_video(corpus_id)
    source = local_whisper_path(corpus_id)
    if not source.exists():
        raise HTTPException(status_code=404, detail="No timestamped transcript exists")

    transcript = workspace_from_whisper(row, source)
    write_json(transcript_path(corpus_id), transcript)
    write_snapshot(corpus_id, transcript, "initial")
    return transcript


def parse_timecode(value: str) -> float:
    parts = value.strip().split(":")
    if len(parts) == 2:
        minutes, seconds = parts
        return int(minutes) * 60 + float(seconds)
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    raise ValueError(f"Invalid timecode: {value}")


def same_time(left: float, right: float) -> bool:
    return round(left, 3) == round(right, 3)


def parse_translation_markdown(content: str) -> tuple[dict[str, str], list[dict[str, Any]]]:
    metadata: dict[str, str] = {}
    sections: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    heading = re.compile(r"^##\s+(.+?)\s+-->\s+(.+?)\s*$")

    for raw_line in content.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.rstrip()
        match = heading.match(line)
        if match:
            if current is not None:
                current["translation"] = "\n".join(current.pop("lines")).strip()
                sections.append(current)
            current = {
                "start": parse_timecode(match.group(1)),
                "end": parse_timecode(match.group(2)),
                "lines": [],
            }
            continue
        if current is None:
            if ":" in line and not line.startswith("#"):
                key, value = line.split(":", 1)
                metadata[key.strip()] = value.strip()
            continue
        current["lines"].append(line)

    if current is not None:
        current["translation"] = "\n".join(current.pop("lines")).strip()
        sections.append(current)
    return metadata, sections


def translation_from_markdown(
    corpus_id: str,
    transcript: dict[str, Any],
    content: str,
    filename: str | None,
    language: str,
) -> dict[str, Any]:
    try:
        metadata, parsed_segments = parse_translation_markdown(content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    source_segments = transcript.get("segments", [])
    source_corpus_id = metadata.get("source_corpus_id")
    if source_corpus_id and source_corpus_id != corpus_id:
        raise HTTPException(
            status_code=400,
            detail=f"Translation is for {source_corpus_id}; expected {corpus_id}",
        )
    if len(parsed_segments) != len(source_segments):
        raise HTTPException(
            status_code=400,
            detail=f"Translation has {len(parsed_segments)} segments; expected {len(source_segments)}",
        )

    segments = []
    mismatches = []
    for index, (source, parsed) in enumerate(zip(source_segments, parsed_segments)):
        source_start = float(source.get("start", 0.0))
        source_end = float(source.get("end", 0.0))
        if not same_time(source_start, parsed["start"]) or not same_time(source_end, parsed["end"]):
            mismatches.append(index + 1)
            continue
        segments.append(
            {
                "id": str(source.get("id", index)),
                "start": source_start,
                "end": source_end,
                "translation": str(parsed.get("translation", "")).strip(),
            }
        )
    if mismatches:
        preview = ", ".join(str(item) for item in mismatches[:8])
        raise HTTPException(status_code=400, detail=f"Timestamp mismatch in block(s): {preview}")

    return {
        "corpus_id": corpus_id,
        "language": metadata.get("language") or language,
        "format": metadata.get("format") or "ashrafent-translation-v1",
        "source_corpus_id": metadata.get("source_corpus_id") or corpus_id,
        "source_transcript_fingerprint": transcript_alignment_fingerprint(transcript),
        "imported_from": filename,
        "segments": segments,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }


def load_translation(corpus_id: str) -> dict[str, Any] | None:
    path = translation_path(corpus_id)
    if path.exists():
        return read_json(path)
    return None


def export_dir(corpus_id: str) -> Path:
    return EXPORTS / corpus_id


def resolve_ffmpeg() -> str:
    candidates = [shutil.which("ffmpeg"), str(IMAGEIO_FFMPEG) if IMAGEIO_FFMPEG.exists() else None]
    for candidate in candidates:
        if not candidate:
            continue
        result = subprocess.run(
            [candidate, "-version"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode == 0:
            return candidate
    raise HTTPException(status_code=500, detail="ffmpeg is not available")


def ass_timestamp(seconds: float) -> str:
    total_centiseconds = max(0, int(round(seconds * 100)))
    centiseconds = total_centiseconds % 100
    total_seconds = total_centiseconds // 100
    secs = total_seconds % 60
    minutes = (total_seconds // 60) % 60
    hours = total_seconds // 3600
    return f"{hours}:{minutes:02d}:{secs:02d}.{centiseconds:02d}"


def ass_text(value: str) -> str:
    text = value.strip()
    text = text.replace("\\", "\\\\")
    text = text.replace("{", "\\{").replace("}", "\\}")
    return "\\N".join(line.strip() for line in text.splitlines() if line.strip())


def ffmpeg_filter_path(path: Path) -> str:
    value = str(path)
    return value.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def subtitle_export_segments(corpus_id: str, track: str) -> tuple[list[dict[str, Any]], str]:
    transcript = ensure_transcript(corpus_id)
    if track != "translation":
        raise HTTPException(status_code=400, detail="MP4 export requires an attached translation")

    translation = load_translation(corpus_id)
    if not translation:
        raise HTTPException(status_code=404, detail="No attached translation to export")
    if translation.get("source_transcript_fingerprint") != transcript_alignment_fingerprint(transcript):
        raise HTTPException(status_code=400, detail="Translation is not aligned with current transcript")
    segments = [
        {
            "start": float(segment.get("start", 0.0)),
            "end": float(segment.get("end", 0.0)),
            "text": str(segment.get("translation", "")).strip(),
        }
        for segment in translation.get("segments", [])
    ]
    return segments, str(translation.get("language") or "fr")


def write_ass_subtitles(path: Path, segments: list[dict[str, Any]], title: str) -> None:
    usable_segments = [
        segment
        for segment in segments
        if segment.get("text") and float(segment.get("end", 0.0)) > float(segment.get("start", 0.0))
    ]
    if not usable_segments:
        raise HTTPException(status_code=400, detail="No non-empty subtitle segment to export")

    lines = [
        "[Script Info]",
        f"Title: {title}",
        "ScriptType: v4.00+",
        "ScaledBorderAndShadow: yes",
        "PlayResX: 1280",
        "PlayResY: 720",
        "WrapStyle: 0",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,Arial,34,&H00FFFFFF,&H000000FF,&H00000000,&HC0000000,0,0,0,0,100,100,0,0,3,1,0,2,80,80,42,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for segment in usable_segments:
        start = ass_timestamp(float(segment["start"]))
        end = ass_timestamp(float(segment["end"]))
        lines.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{ass_text(str(segment['text']))}")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def public_export_job(job: dict[str, Any]) -> dict[str, Any]:
    output_path = job.get("output_path")
    media_url = None
    if output_path:
        path = Path(output_path)
        if path.exists():
            media_url = f"/media/{path.relative_to(ROOT)}"
    return {
        "id": job["id"],
        "corpus_id": job["corpus_id"],
        "track": job["track"],
        "status": job["status"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "media_url": media_url,
        "error": job.get("error"),
    }


def run_export_job(job_id: str, command: list[str]) -> None:
    job = EXPORT_JOBS[job_id]
    job["status"] = "running"
    job["updated_at"] = now_iso()
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        job["log"] = result.stdout[-8000:]
        job["returncode"] = result.returncode
        job["status"] = "completed" if result.returncode == 0 else "failed"
        if result.returncode != 0:
            job["error"] = "ffmpeg export failed"
    except Exception as exc:  # pragma: no cover - defensive job boundary
        job["status"] = "failed"
        job["error"] = str(exc)
    finally:
        job["updated_at"] = now_iso()


def start_video_export(corpus_id: str, track: str) -> dict[str, Any]:
    row = find_video(corpus_id)
    video_value = row.get("video_path")
    if not video_value:
        raise HTTPException(status_code=404, detail="No source video for this corpus item")
    source_video = safe_path(video_value)
    if not source_video.exists():
        raise HTTPException(status_code=404, detail="Source video file is missing")

    segments, _language = subtitle_export_segments(corpus_id, track)
    out_dir = export_dir(corpus_id)
    stem = f"{corpus_id}_{track}_{filename_timestamp()}"
    ass_path = out_dir / f"{stem}.ass"
    output_path = out_dir / f"{stem}.mp4"
    write_ass_subtitles(ass_path, segments, row.get("title") or corpus_id)

    command = [
        resolve_ffmpeg(),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source_video),
        "-vf",
        f"subtitles='{ffmpeg_filter_path(ass_path)}'",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        str(output_path),
    ]

    job_id = uuid.uuid4().hex
    EXPORT_JOBS[job_id] = {
        "id": job_id,
        "corpus_id": corpus_id,
        "track": track,
        "status": "queued",
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "ass_path": str(ass_path),
        "output_path": str(output_path),
    }
    thread = threading.Thread(target=run_export_job, args=(job_id, command), daemon=True)
    thread.start()
    return EXPORT_JOBS[job_id]


@app.get("/api/videos")
def list_videos() -> dict[str, Any]:
    return {"videos": [public_video(row) for row in read_manifest()]}


@app.get("/api/videos/{corpus_id}")
def get_video(corpus_id: str) -> dict[str, Any]:
    row = find_video(corpus_id)
    return {
        "video": public_video(row),
        "transcript": load_best_transcript(corpus_id),
    }


@app.post("/api/videos/{corpus_id}/transcript/ensure")
def api_ensure_transcript(corpus_id: str) -> dict[str, Any]:
    return {"transcript": ensure_transcript(corpus_id), "recovery": recovery_state(corpus_id)}


@app.put("/api/videos/{corpus_id}/transcript")
def save_transcript(corpus_id: str, payload: TranscriptSave) -> dict[str, Any]:
    find_video(corpus_id)
    transcript = payload.transcript
    transcript["corpus_id"] = corpus_id
    transcript["updated_at"] = now_iso()
    write_json(transcript_path(corpus_id), transcript)
    return {"ok": True, "path": str(transcript_path(corpus_id).relative_to(ROOT))}


@app.put("/api/videos/{corpus_id}/transcript/autosave")
def autosave_transcript(corpus_id: str, payload: TranscriptSave) -> dict[str, Any]:
    return save_transcript(corpus_id, payload)


@app.post("/api/videos/{corpus_id}/snapshots")
def create_snapshot(corpus_id: str, payload: SnapshotSave) -> dict[str, Any]:
    find_video(corpus_id)
    transcript = payload.transcript or load_best_transcript(corpus_id)
    if not transcript:
        raise HTTPException(status_code=404, detail="No transcript to snapshot")
    transcript["corpus_id"] = corpus_id
    transcript["updated_at"] = now_iso()
    write_json(transcript_path(corpus_id), transcript)
    path = write_snapshot(corpus_id, transcript)
    return {
        "ok": True,
        "path": str(path.relative_to(ROOT)),
        "recovery": recovery_state(corpus_id),
        "snapshots": [snapshot_info(item, transcript) for item in user_snapshot_paths(corpus_id)],
    }


@app.get("/api/videos/{corpus_id}/snapshots")
def list_snapshots(corpus_id: str) -> dict[str, Any]:
    find_video(corpus_id)
    current = load_best_transcript(corpus_id)
    return {"snapshots": [snapshot_info(path, current) for path in user_snapshot_paths(corpus_id)]}


@app.get("/api/videos/{corpus_id}/snapshots/{snapshot_id}")
def get_snapshot(corpus_id: str, snapshot_id: str) -> dict[str, Any]:
    find_video(corpus_id)
    path = user_snapshot_path(corpus_id, snapshot_id)
    return {"snapshot": snapshot_info(path, load_best_transcript(corpus_id)), "transcript": read_json(path)}


@app.post("/api/videos/{corpus_id}/snapshots/{snapshot_id}/restore")
def restore_named_snapshot(corpus_id: str, snapshot_id: str) -> dict[str, Any]:
    find_video(corpus_id)
    return restore_snapshot_file(corpus_id, user_snapshot_path(corpus_id, snapshot_id))


@app.post("/api/videos/{corpus_id}/transcript/restore-snapshot")
def restore_latest_snapshot(corpus_id: str) -> dict[str, Any]:
    find_video(corpus_id)
    latest = latest_snapshot_path(corpus_id)
    if not latest:
        raise HTTPException(status_code=404, detail="No snapshot to restore")
    return restore_snapshot_file(corpus_id, latest)


@app.get("/api/videos/{corpus_id}/translation")
def get_translation(corpus_id: str) -> dict[str, Any]:
    find_video(corpus_id)
    return {"translation": load_translation(corpus_id)}


@app.put("/api/videos/{corpus_id}/translation")
def save_translation(corpus_id: str, payload: TranslationSave) -> dict[str, Any]:
    transcript = ensure_transcript(corpus_id)
    translation = payload.translation
    if translation.get("source_transcript_fingerprint") != transcript_alignment_fingerprint(transcript):
        raise HTTPException(status_code=400, detail="Translation is not aligned with current transcript")
    translation["corpus_id"] = corpus_id
    translation["updated_at"] = now_iso()
    write_json(translation_path(corpus_id), translation)
    return {"ok": True, "path": str(translation_path(corpus_id).relative_to(ROOT))}


@app.post("/api/videos/{corpus_id}/translation/import")
def import_translation(corpus_id: str, payload: TranslationImport) -> dict[str, Any]:
    transcript = ensure_transcript(corpus_id)
    existing = load_translation(corpus_id)
    if existing and not payload.replace:
        raise HTTPException(status_code=409, detail="Translation already exists")
    translation = translation_from_markdown(
        corpus_id,
        transcript,
        payload.content,
        payload.filename,
        payload.language,
    )
    if existing:
        write_translation_snapshot(corpus_id, existing, "pre_replace")
    write_json(translation_path(corpus_id), translation)
    write_translation_snapshot(corpus_id, translation, "import")
    return {"ok": True, "translation": translation}


@app.post("/api/videos/{corpus_id}/translation/snapshots")
def create_translation_snapshot(corpus_id: str, payload: TranslationSave) -> dict[str, Any]:
    save_translation(corpus_id, payload)
    path = write_translation_snapshot(corpus_id, payload.translation)
    return {"ok": True, "path": str(path.relative_to(ROOT))}


@app.post("/api/videos/{corpus_id}/exports/video")
def create_video_export(corpus_id: str, payload: VideoExportRequest) -> dict[str, Any]:
    job = start_video_export(corpus_id, payload.track)
    return {"job": public_export_job(job)}


@app.get("/api/exports/jobs/{job_id}")
def get_export_job(job_id: str) -> dict[str, Any]:
    job = EXPORT_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Unknown export job")
    return {"job": public_export_job(job)}


@app.get("/media/{path:path}")
def media(path: str) -> FileResponse:
    file_path = safe_path(path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Media file not found")
    return FileResponse(file_path)
