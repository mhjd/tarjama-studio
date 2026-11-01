"""Pocket TTS French preset, public non-cloning weights, CPU inference."""
import hashlib
from pathlib import Path

from workspace import CLIError, atomic_write


CACHE = Path(__file__).resolve().parents[1] / ".cache/pocket"


def assets(model, speaker):
    if model not in (None, "french_24l") or speaker != "estelle":
        raise CLIError("Cet essai Pocket utilise --model french_24l --speaker estelle.")
    try:
        import pocket_tts
        import yaml
        from pocket_tts.utils.utils import download_if_necessary, get_predefined_voice
    except ImportError as exc:
        raise CLIError("Pocket TTS manquant : make cli-pocket-setup.") from exc
    # Use the pinned configuration/voice revisions shipped with pocket-tts 3.3.0.
    builtin = Path(pocket_tts.__file__).parent / "config/french_24l.yaml"
    config = yaml.safe_load(builtin.read_text(encoding="utf-8"))
    weights = download_if_necessary(config["weights_path_without_voice_cloning"])
    tokenizer_url = config["flow_lm"]["lookup_table"]["tokenizer_path"]
    tokenizer = download_if_necessary(tokenizer_url)
    voice = download_if_necessary(get_predefined_voice("french_24l", "estelle"))
    config["weights_path"] = str(weights)
    config.pop("weights_path_without_voice_cloning", None)
    config["flow_lm"]["lookup_table"]["tokenizer_path"] = str(tokenizer)
    local = CACHE / "french_24l.yaml"
    atomic_write(local, yaml.safe_dump(config, allow_unicode=True).encode())
    return local, weights, tokenizer, voice


class PocketFrenchVoice:
    def __init__(self, backend, model, speaker, reference, max_tokens):
        if backend != "torch-cpu" or reference or speaker != "estelle":
            raise CLIError("Pocket français : voix Estelle sur CPU, sans clonage.")
        import torch
        import soundfile
        from pocket_tts import TTSModel
        from pocket_tts.utils.utils import download_if_necessary, get_predefined_voice
        torch.set_num_threads(4)
        torch.set_num_interop_threads(1)
        self.torch, self.sf = torch, soundfile
        self.model = TTSModel.load_model(config=model)
        voice = download_if_necessary(get_predefined_voice("french_24l", "estelle"))
        self.state = self.model.get_state_for_audio_prompt(str(voice))

    def generate(self, text, output):
        # Stable per-paragraph seed, including on resume. The library internally
        # chunks long text; fit the complete returned audio once in tts_export.
        self.torch.manual_seed(int(hashlib.sha256(text.encode()).hexdigest()[:8], 16))
        # Pocket updates its caches from worker threads. InferenceMode is
        # thread-local: caches created here under that mode fail in those workers.
        # no_grad disables gradients without creating inference-only tensors.
        with self.torch.no_grad():
            audio = self.model.generate_audio(self.state, text, max_tokens=50, copy_state=True)
        audio = audio.detach().cpu().numpy()
        import numpy as np
        if not len(audio) or not np.isfinite(audio).all() or not np.any(audio):
            raise CLIError("Pocket a produit un audio vide ou invalide.")
        self.sf.write(str(output), audio, self.model.sample_rate, subtype="PCM_16")
