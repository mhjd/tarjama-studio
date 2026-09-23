# Transcription incident — 2026-09-23

## Confirmed cause

A 3,612,829 ms video downloaded successfully. Its first 600-second ASR audio
extraction succeeded (9,021,145 bytes, below the provider upload limit). The web
worker rejected Groq segment 60: start 294.43988, end 313.49976, blank text.
No transcription chunk was committed. A single guarded retry with diagnostic
logging reproduced `asr_invalid_segment` at 23:17:07 UTC. This was not caused
by a playlist URL or the earlier media disk-reserve failure.

The desktop `ui/electron/groq.ts` attempts word-level recovery before rejecting
blank segments. The web implementation previously rejected them before recovery.
It now recovers word-level text first; a blank span without recoverable words
remains an error rather than silently losing a possibly spoken passage.
Zero-duration spans are omitted, matching the desktop merge. Negative, reversed and non-finite
timestamps remain errors; final transcript validation still rejects an entirely
empty transcript. No provider payload, speech text or credentials were logged.

## Validation

The exact staged release backend passed `go test -race -count=1 ./...` and
`go vet ./...`. New regression tests cover the observed blank interval recovered between
speech, short/long blank spans recovered from words, zero-duration spans,
unrecoverable text, malformed timestamps and all-empty output.

The release uses the previously qualified backend b69c700 plus the explicit
upload/isolated-media fixes and this ASR patch. Pending translation/research
changes are excluded by `web/scripts/prepare-upload-release.py`.

Worker image:
`preview.local/atelier/web@sha256:848dad0cbbc9b0d1735201eed9fa5ab30e451de50c5b57bf7c13387a11676378`

Docker image ID for future frontend-only builds:
`sha256:cf5bdd756320423e6cced3429e0a49bfd715b0d3dffa1190fad89fa00635c098`

`validate` and `plan` passed for revision `22c0d7fffdce04c5`.
The web frontend and other services retain their previous images. No schema,
network protection, secret or user document changes are part of this deployment.

## Controlled recovery

The operational recipe contains a read-only metadata diagnostic and an explicit
one-shot recovery job. Recovery locks the project row and only requeues the
specific failed transcription when its generation, source version, project stage
and expected media attempt still match. This preserves edits made in the meantime
and makes repeated invocation a no-op. It increments the media attempt exactly
as the application retry endpoint does, avoiding reuse of retired media artifacts.
The video is not downloaded again. No migration job is run.

An intermediate deployment recovered and committed chunks. During review, the
fallback for unrecoverable blank spans was tightened to match desktop's explicit
error rather than treating all blank spans as silence. Final verification checks
recoverability from stored provider words without logging any text. All raw chunk
responses remain available to the final strict merge.

Production verification at 23:26 UTC:

- All four enabled services ready; revision `22c0d7fffdce04c5`.
- The affected transcription succeeded at 23:25:38 UTC, 100%, seven saved chunks
  starting at 0, 580, 1160, 1740, 2320, 2900 and 3480 seconds.
- All 18 blank provider spans have nonempty, positive-duration word timestamps
  inside their segment bounds. No unrecoverable blank span was silently omitted
  by the intermediate deployment. The document contains 970 segments.
- Automatic Arabic cleanup started and reached 24% at 23:26:10 UTC.
- The earlier duplicate failed project was not restarted; only the latest affected
  project was recovered. The same code correction applies when its owner retries.

This verifies the live transcription and its automatic transition. It does not
assert linguistic accuracy of all 970 segments or a new full UI/export run.
