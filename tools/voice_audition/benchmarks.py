"""SQLite job metadata and fixed local paths; no TTS imports in the web server."""
from pathlib import Path

KEY = "logique-source300-qwen03-v1"
LABEL = "Importance de la logique · début 5 min 17 s · Qwen3-TTS 1.7B · température 0,3"


def folder(database):
    return Path(database).parent / "benchmarks" / KEY


def voice_folder(database, voice_path):
    return folder(database) / Path(voice_path).stem


def initialize(db):
    db.execute("""CREATE TABLE IF NOT EXISTS benchmarks (
        benchmark_id TEXT NOT NULL, voice_path TEXT NOT NULL REFERENCES voices(path),
        status TEXT NOT NULL CHECK(status IN ('pending','preparing','running','ready','error')),
        completed_parts INTEGER NOT NULL DEFAULT 0, total_parts INTEGER NOT NULL,
        duration_seconds REAL, audio_sha256 TEXT, audio_bytes INTEGER, error TEXT,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY(benchmark_id,voice_path))""")
    db.execute('''CREATE TABLE IF NOT EXISTS benchmark_videos (
        voice_path TEXT PRIMARY KEY REFERENCES voices(path), status TEXT NOT NULL,
        video_bytes INTEGER, video_sha256 TEXT, duration_seconds REAL, error TEXT)''')


def public_state(database, connect):
    with connect(database) as db:
        rows = [dict(r) for r in db.execute("SELECT * FROM benchmarks WHERE benchmark_id=?", (KEY,))]
        videos = {r['voice_path']:dict(r) for r in db.execute('SELECT * FROM benchmark_videos')}
    for row in rows:
        path = voice_folder(database, row["voice_path"]) / "benchmark.m4a"
        ready = row["status"] == "ready" and path.is_file() and path.stat().st_size == row["audio_bytes"]
        row["url"] = "/api/benchmark-audio/" + Path(row["voice_path"]).stem + ".m4a" if ready else None
        video = videos.get(row['voice_path'], {})
        artifact = voice_folder(database,row['voice_path']) / 'video-v1/audit.mp4'
        video_ready = video.get('status') == 'ready' and artifact.is_file() and artifact.stat().st_size == video.get('video_bytes')
        row.update(video_url='/api/benchmark-video/' + Path(row['voice_path']).stem + '.mp4' if video_ready else None,
                   video_status='ready' if video_ready else video.get('status','pending'), video_error=video.get('error'),
                   video_duration_seconds=video.get('duration_seconds'))
        if video.get('status') == 'ready' and not video_ready:
            row.update(video_status='error',video_error='Vidéo absente ou modifiée ; vérifier le rendu local.')
        if row["status"] == "ready" and not ready:
            row.update(status="error", error="Fichier audio absent ou modifié ; relancer le benchmark.")
    return {"key": KEY, "label": LABEL, "voices": rows}
