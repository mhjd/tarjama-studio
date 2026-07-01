# Project Guidance

This project must remain understandable at human scale. Prefer explicit, boring code over clever abstractions, and add structure only when it removes real complexity.

## Product Goal

Build a local-first app to help transcribe, correct, and translate Arabic audio/video:

1. select a corpus video;
2. load an existing timestamped transcription if available;
3. generate one from the CLI if missing;
4. correct segments while listening precisely in the web app;
5. translate segments or chunks while preserving timestamps.

## Engineering Rules

- Keep raw benchmark outputs in `data/model_outputs/` auditable; do not silently overwrite them.
- Save user edits under `data/workspaces/<corpus_id>/`.
- Treat snapshots under `data/workspaces/<corpus_id>/snapshots/` as immutable history; preview them read-only and restore by copying into `transcript.json` only after explicit confirmation, never by editing a snapshot in place.
- Prefer a small number of clear modules over framework-heavy architecture.
- Keep APIs simple and file-backed until a real database is needed.
- Avoid adding dependencies unless they clearly simplify the MVP.
- Make local development easy to start and inspect.

## Current App Direction

- Frontend: React + TypeScript + Vite.
- Backend: FastAPI local server.
- Initial transcription format: Whisper-style JSON converted into a stable workspace JSON.
- CLI: download YouTube videos, list missing transcripts, run local Whisper, and create workspace JSON.
- Web MVP priority: video selection, audio player, editable timestamped segments, silent current-state persistence, and explicit immutable saves in snapshots. Do not run transcription jobs from the web UI.
