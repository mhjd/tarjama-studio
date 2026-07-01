# ASR Models

Selected for the first run:

- `mlx-community/whisper-large-v3-mlx`
  - Official Whisper large-v3 weights converted for MLX/Apple Silicon.
  - Used as the baseline for `openai/whisper-large-v3`.

- `Byne/whisper-large-v3-arabic`
  - Hugging Face Transformers model.
  - Fine-tuned from `openai/whisper-large-v3`.
  - Pipeline tag: `automatic-speech-recognition`.
  - License: Apache-2.0.
  - Note: repository storage includes extra train/test artifacts, but Transformers downloads only the model/processor files needed by `from_pretrained`.

Secondary candidate:

- `Jabbar111/whisper-large-v3-ar-cv110-fleurs`
  - Fine-tuned from `openai/whisper-large-v3`.
  - Kept as a backup/second comparison candidate.
  - Root repo appears to omit tokenizer files, so the runner should use `--processor openai/whisper-large-v3` if this model is run.

Not first priority:

- `AbdelrahmanHassan/whisper-large-v3-egyptian-arabic`
  - LoRA/PEFT adapter for Egyptian Arabic.
  - Small and interesting, but less aligned with the current MSA/scholarly lecture corpus.
