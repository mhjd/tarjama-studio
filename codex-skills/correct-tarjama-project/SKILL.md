---
name: correct-tarjama-project
description: Safely apply reviewer feedback to a local Tarjama Studio project's Arabic transcript or French translation. Use when the user says “Corrige le projet …”, provides bullet-point corrections from Arabic reviewers, asks to fix a named Tarjama video/project, or pastes loose correction notes that probably concern one of the most recently edited projects. Resolve the local Electron project, map each requested edit to exact segment IDs, preview the diff, preserve timestamps and structure, create auditable backups/snapshots, and keep current.json, transcript.json, translation.json, and review metadata coherent.
---

# Correct Tarjama Project

Apply human-provided textual corrections to Tarjama Studio data without opening or editing JSON by hand. Use the bundled script for discovery, validation, preview, and mutation; do not reproduce its storage logic ad hoc.

## Non-negotiable safeguards

- Never edit while Tarjama Studio or its Electron development process is running. Its autosave can overwrite external changes.
- Never modify segment IDs, timestamps, segment order, media, or existing snapshots.
- Never silently choose a project merely because it is the newest. Recency narrows the search; matching title or segment content establishes the target.
- Never infer a replacement when the reviewer note has more than one reasonable interpretation. Ask one concise clarification.
- Never apply before showing the resolved project and an exact before/after preview, then receiving explicit user confirmation.
- Treat an Arabic correction as invalidating both Arabic and translation review confirmation. Treat a French-only correction as invalidating only translation confirmation.
- Use the script's `apply` command. It creates exact pre-change backups plus immutable pre/post application snapshots and updates the live files together.

## Workflow

The script path is `scripts/project_corrections.py`, relative to this `SKILL.md`. Run `python3 <script> --help` if the interface is unclear.

### 1. Locate the project

For a named project:

```bash
python3 <script> inspect --project "TITLE OR ID" --segments
```

For loose notes without a reliable title, first list recent projects and then search distinctive old wording from the notes:

```bash
python3 <script> list --limit 8
python3 <script> search --recent 8 --text "distinctive existing words" --text "another phrase"
```

Choose automatically only when all useful evidence points to one project. If several recent projects remain plausible, show their titles and dates and ask which one. Do not edit legacy `Electron` or `Ashrafent` libraries unless the user explicitly supplies that root.

### 2. Resolve every bullet to exact data

Inspect the candidate's segments. Map each correction to:

- `text` for the Arabic transcription;
- `translation` for the French translation;
- one exact `segment_id`;
- the full exact current field value (`expected`);
- the full desired field value (`replacement`).

Preserve punctuation and surrounding text that the reviewer did not ask to change. If a correction spans adjacent segments, represent each segment edit separately. If the note only identifies a timestamp, use it to locate the segment but do not alter it.

### 3. Create a plan

Write a temporary UTF-8 JSON file outside the project library, normally under `/tmp`. Use this schema:

```json
{
  "project_id": "youtube_example",
  "changes": [
    {
      "segment_id": "12",
      "field": "text",
      "expected": "النص الحالي الكامل",
      "replacement": "النص المصحح الكامل",
      "reason": "Retour fourni par le correcteur"
    },
    {
      "segment_id": "12",
      "field": "translation",
      "expected": "Traduction actuelle complète.",
      "replacement": "Traduction corrigée complète.",
      "reason": "Accord à corriger"
    }
  ]
}
```

Do not use search-and-replace across all segments. The `expected` value is an optimistic concurrency check and must be exact.

### 4. Preview and confirm

```bash
python3 <script> preview --plan /tmp/tarjama-corrections.json
```

The preview must succeed with no mismatch. Summarize the resolved title, affected segment IDs/times, exact before/after text, and which review confirmations will be cleared. Ask the user to:

1. close Tarjama Studio completely;
2. explicitly confirm applying this preview.

If the user already explicitly confirmed this exact preview and stated the app is closed, proceed without asking again.

### 5. Apply and verify

After confirmation:

```bash
python3 <script> apply --plan /tmp/tarjama-corrections.json --app-is-closed
python3 <script> inspect --project "PROJECT_ID" --segments
```

Report the backup directory and created snapshots from the apply result. Verify the corrected values in the final inspect output. If the app later shows a recovery choice because an older build orders snapshot filenames lexically, choose **Reprendre**: the script has already updated both the current state and explicit saved state.

## Interpreting reviewer notes

- A note such as “remplacer X par Y” authorizes only that substitution in the identified segment.
- A quoted Arabic phrase normally targets `text`; a quoted French phrase normally targets `translation`.
- A suggested French meaning for an Arabic correction is a separate translation change only if the reviewer clearly requests it.
- Comments such as “mauvais”, “à revoir”, or “ce mot est faux” without a definitive replacement require clarification.
- Do not perform stylistic cleanup, grammar changes, retranslations, or neighboring edits that are absent from the list.

Read [storage-model.md](references/storage-model.md) only when diagnosing an unusual state, a failed validation, legacy storage, or recovery behavior.
