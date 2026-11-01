"""Lazy local Qwen3-TTS 1.7B adapters; never loaded for prompts or --plan-only."""

from __future__ import annotations

import platform
from pathlib import Path

from workspace import CLIError

NARRATION_STYLE = "Parlez en français avec une diction claire, calme et posée, comme une narration documentaire naturelle, sans emphase excessive."
FRENCH_FEMALE_DESIGN = (
    "A native French female narrator from France, in her thirties, with a warm, clear, medium-pitched voice. "
    "She speaks fluent standard metropolitan French with natural French vowels, nasal sounds, rhythm and liaison. "
    "Calm, professional documentary delivery at a natural conversational pace."
)

def settings(backend: str, model: str | None, clone: bool, *, voice_design=False) -> tuple[str, str]:
    if clone and voice_design:
        raise CLIError("VoiceDesign et clonage sont deux modes distincts.")
    if backend == "auto":
        backend = "mlx" if platform.system() == "Darwin" and platform.machine() == "arm64" else "torch"
    variant = "VoiceDesign" if voice_design else "Base" if clone else "CustomVoice"
    if model is None:
        model = (f"mlx-community/Qwen3-TTS-12Hz-1.7B-{variant}-4bit" if backend == "mlx"
                 else f"Qwen/Qwen3-TTS-12Hz-1.7B-{variant}")
    return backend, model


class QwenVoice:
    def __init__(self, backend: str, model: str, speaker: str, reference: Path | None, max_tokens: int, *, description=None, reference_text=None, sampling=None):
        if description and reference:
            raise CLIError("VoiceDesign ne prend pas de référence de clonage.")
        self.backend, self.speaker = backend, speaker
        self.reference, self.max_tokens = reference, max_tokens
        self.description = description
        if reference_text is not None and (not reference or not reference_text.strip()):
            raise CLIError("Une transcription de référence exige un audio et un texte non vide.")
        self.reference_text = reference_text
        self.sampling = dict(sampling or {})
        try:
            import soundfile as sf
            self.sf = sf
            if backend == "mlx":
                import mlx.core as mx
                from mlx_audio.tts.utils import load_model
                mx.set_default_device(mx.gpu)
                # MLX's default free-buffer cache may exceed physical RAM. Keep
                # reusable buffers bounded; this does not cap live model memory.
                mx.set_cache_limit(1024 * 1024 * 1024)
                self.model = load_model(model)
                is_design = self.model.config.tts_model_type == "voice_design"
                if is_design != bool(self.description):
                    raise CLIError("Le mode --voice-design et le type réel du modèle doivent correspondre.")
                self.clone_prompt = None
            else:
                import torch
                from qwen_tts import Qwen3TTSModel
                device = "cuda:0" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
                self.model = Qwen3TTSModel.from_pretrained(
                    model, device_map=device, dtype=torch.float32 if device == "cpu" else torch.bfloat16,
                    attn_implementation="sdpa",
                )
                self.clone_prompt = (self.model.create_voice_clone_prompt(
                    ref_audio=str(reference), ref_text=reference_text,
                    x_vector_only_mode=reference_text is None,
                ) if reference else None)
        except ImportError as exc:
            raise CLIError(f"Dépendances TTS absentes ({exc}). Lancez make cli-tts-setup.") from exc

    def generate(self, text: str, output: Path) -> None:
        if self.backend == "mlx":
            import numpy as np
            if self.reference:
                kwargs = {"ref_audio": str(self.reference)}
                if self.reference_text:
                    kwargs["ref_text"] = self.reference_text
            elif self.description:
                kwargs = {"instruct": self.description}
            else:
                kwargs = {"voice": self.speaker, "instruct": NARRATION_STYLE}
            chunks = list(self.model.generate(
                text=text, lang_code="French", max_tokens=self.max_tokens,
                stream=False, verbose=False, **kwargs, **getattr(self, "sampling", {}),
            ))
            if len(chunks) != 1 or chunks[0].token_count >= self.max_tokens:
                counts = [c.token_count for c in chunks]
                raise CLIError(f"Génération TTS vide, fragmentée ou tronquée ({len(chunks)} fragments, tokens={counts}, "
                               f"limite={self.max_tokens}) ; réduisez la taille des paragraphes.")
            audio, rate = np.asarray(chunks[0].audio), chunks[0].sample_rate
        else:
            kwargs = dict(text=text, language="French", max_new_tokens=self.max_tokens, non_streaming_mode=True)
            kwargs.update(getattr(self, "sampling", {}))
            if self.reference:
                wavs, rate = self.model.generate_voice_clone(voice_clone_prompt=self.clone_prompt, **kwargs)
            elif self.description:
                wavs, rate = self.model.generate_voice_design(instruct=self.description, **kwargs)
            else:
                wavs, rate = self.model.generate_custom_voice(speaker=self.speaker, instruct=NARRATION_STYLE, **kwargs)
            if len(wavs) != 1:
                raise CLIError("Réponse vocale vide ou inattendue")
            audio = wavs[0]
        # The official high-level API returns no finish reason. Refuse audio near
        # the 12 Hz frame budget instead of fitting a potentially truncated take.
        if len(audio) == 0 or len(audio) / rate >= (self.max_tokens - 2) / 12:
            raise CLIError("Audio TTS vide ou limite de génération atteinte")
        self.sf.write(str(output), audio, rate, subtype="PCM_16")

    def generate_batch(self, texts: list[str], outputs: list[Path]) -> None:
        """One MLX model, several independent paragraphs in a GPU batch."""
        if self.backend != "mlx" or not self.reference or not self.reference_text:
            raise CLIError("Le traitement TTS par lots exige MLX avec audio et texte de référence.")
        if len(texts) != len(outputs) or not texts:
            raise CLIError("Lot TTS invalide.")
        import numpy as np
        seen = set()
        for chunk in self.model.batch_generate(
            texts=texts, ref_audio=str(self.reference), ref_text=self.reference_text,
            lang_code="French", max_tokens=self.max_tokens, stream=False, verbose=False, **getattr(self, "sampling", {}),
        ):
            index = chunk.sequence_idx
            if (type(index) is not int or not 0 <= index < len(texts) or index in seen
                    or chunk.token_count >= self.max_tokens or len(chunk.audio) == 0
                    or len(chunk.audio) / chunk.sample_rate >= (self.max_tokens - 2) / 12):
                raise CLIError("Lot TTS vide, dupliqué, tronqué ou désaligné.")
            self.sf.write(str(outputs[index]), np.asarray(chunk.audio), chunk.sample_rate, subtype="PCM_16")
            seen.add(index)
        if len(seen) != len(texts):
            raise CLIError("Lot TTS incomplet ; les paragraphes précédemment terminés restent réutilisables.")
