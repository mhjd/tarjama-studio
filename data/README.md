# Benchmark Corpus Layout

This directory stores source media, ground-truth transcripts, provenance metadata, and future model outputs separately.

- `raw/videos/`: downloaded source videos. For the Dedew corpus, `*_merged.mp4` contains video plus AAC audio. The `*.f135.mp4` and `*.f251.webm` files are the original separate YouTube streams kept for traceability.
- `raw/audio/`: normalized audio for ASR evaluation. Current files are mono 16 kHz WAV.
- `ground_truth/transcripts/`: manually prepared reference transcripts. Keep original formats (`.docx`) and extracted plain text (`.txt`).
- `ground_truth/subtitles/`: reserved for human YouTube subtitle files if found later.
- `metadata/`: copied `yt-dlp` descriptions and info JSON files.
- `manifests/`: machine-readable corpus indexes.
- `model_outputs/`: future transcription outputs from evaluated models.
- `notes/`: source vetting notes and benchmark decisions.

Current validated corpus:

- `manifests/dedew_manifest.jsonl`

Validation status: the first corpus uses external `.docx` transcriptions linked from YouTube descriptions as `رابط التفريغ النصي`, plus one IslamWeb `FullContent` transcript for `الدعاء المستجاب`. These are not YouTube automatic captions. `yt-dlp --list-subs` found no YouTube subtitle tracks for the checked videos, so alignment is transcript-level rather than subtitle-segment-level.
