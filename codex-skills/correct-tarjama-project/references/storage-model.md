# Tarjama Studio storage model

The active Electron library is normally:

- macOS: `~/Library/Application Support/Tarjama Studio/projects/`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/Tarjama Studio/projects/`
- Windows: `%APPDATA%/Tarjama Studio/projects/`

Each child directory is a project. The correction script intentionally ignores legacy app-name roots unless `--root` is supplied explicitly.

## Live files

- `project.json`: title, paths, update time, and review timestamps/fingerprints.
- `current.json`: transcript state loaded first by the application and updated by silent autosave.
- `transcript.json`: transcript at the last explicit application save point.
- `translation.json`: separate French translation aligned by segment ID and timestamps.
- `snapshots/*.json`: immutable combined transcript snapshots; translation text is overlaid into each segment.
- `translation_snapshots/*.json`: immutable translation-only snapshots.

The script applies a correction to `current.json`, then writes the same plain Arabic state to `transcript.json`. It updates `translation.json` when necessary, writes a combined `save_*` snapshot, and keeps translations out of the live transcript files just as the Electron application does.

## Review state

Review confirmation is content-addressed. Changing Arabic makes the old transcript fingerprint invalid and can make the translation stale, so the script clears both transcript and translation review metadata. Changing only French preserves the transcript confirmation and clears translation review metadata.

The script does not mark externally applied corrections as reviewed. The user can reopen the app, verify the result, and confirm the appropriate stage normally.

## Safety and recovery

Before changing live files, the script creates `codex_backups/<UTC timestamp>/` with byte-for-byte copies of every live JSON file plus a hash manifest. It also writes `pre_codex_correction_*` application snapshots. Existing snapshots are never overwritten.

Writes use temporary files in the same project directory followed by atomic replacement. The script takes a project lock and rejects stale `expected` text, duplicate targets, malformed segments, misaligned translations, or a detected running Tarjama/Electron process.

If an exceptional partial write occurs, the script attempts to restore the exact originals from memory; the `codex_backups` directory remains available for manual recovery.
