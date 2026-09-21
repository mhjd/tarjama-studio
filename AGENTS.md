# Project Guidance

This project must remain understandable at human scale. Prefer explicit, boring code over clever abstractions, and add structure only when it removes real complexity.

## Web/VPS migration — read first

- The current web migration brief is [docs/WEB_VPS_HANDOFF.md](docs/WEB_VPS_HANDOFF.md). Read it completely before implementing the new hosted application. It records the user's final decisions, superseded ideas, desktop source map, branch instructions, and acceptance criteria.
- The implementation reference is the latest **desktop** application: `DesktopApp` in `ui/src/main.tsx` and the modules under `ui/electron/`. The older FastAPI `server/`, the older `App` in that same TSX file, the legacy browser API adapter, and the old CLI-led web workflow are obsolete for this migration. Do not revive them or use them as the new backend/frontend baseline.
- Implement the hosted application on `web-vps`, starting from the desktop-derived handoff commit. Keep `desktop` for desktop maintenance; do not overwrite either branch or force-push. See the handoff for the verified desktop source commit and safe checkout commands.
- Explicit stopping point: finish implementation, tests, builds, and deployment preparation, then stop **before deployment**. Isolated local/loopback development tests are allowed; do not publish the app, activate a staging/production stack, change live proxy/DNS/firewall/SSO settings, or migrate live user data. Report the tested commit, remaining prerequisites, and prepared commands; wait for the user's separate deployment instructions.
- For the new hosted product, the final user decisions override the historical local-MVP directions below: Go backend preference, private user workspaces, mobile-first web UI, Gemini correction/translation, Groq transcription, shared keys with persistent waiting queues and optional personal keys, no OpenRouter, no token credits, no custom prompts, dark-only UI, no manual saves and no user-facing revision history.
- Web text edits save on blur only when changed. Advancing a stage or exporting must explicitly flush and await pending saves. Removing user-facing history does not authorize deleting old desktop snapshots or removing operational database backups.
- The original local/desktop storage and immutable-snapshot rules below still apply to maintenance of existing desktop data, including the desktop correction skill. They are not a requirement to recreate snapshots in the hosted application.

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
- When giving the user project commands, prefer `make ...` targets over raw `python`, `npm`, or nested `cd ui && ...` commands. Add a Makefile target first if a repeated project workflow lacks one.
- Treat `desktop` as the ongoing development branch. When synchronizing it into `main`, merge and push `main`, then switch back to `desktop`; keep this `AGENTS.md` rule present on both branches.

## Historical local/desktop direction (not the hosted migration specification)

- Frontend: React + TypeScript + Vite.
- Backend: FastAPI local server.
- Initial transcription format: Whisper-style JSON converted into a stable workspace JSON.
- CLI: prioritize the guided YouTube pipeline: download, transcribe with local Whisper, copy the cleanup prompt, then import the cleaned ChatGPT JSON. Keep separate list/transcribe/download/import commands available as deprecated maintenance actions.
- Web MVP priority: video selection, audio player, editable timestamped segments, silent current-state persistence, and explicit immutable saves in snapshots. Do not run transcription jobs from the web UI.
- Desktop direction: Electron reviewer app under `ui/electron/` for non-technical users. Keep filesystem access behind IPC, copy imports into the app library, verify downloaded media has audio and video, and never delete outside `app.getPath("userData")/projects`; use the OS trash for project deletion.
