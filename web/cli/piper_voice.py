"""French fixed-voice Piper adapter, CPU only; no text rewriting or cloning."""
from pathlib import Path
import wave

from workspace import CLIError, read_json


MODELS = {"Tom": ("fr_FR-tom-medium", None), "Pierre": ("fr_FR-upmc-medium", "pierre")}
CACHE = Path(__file__).resolve().parents[1] / ".cache/piper"


def assets(speaker, model=None):
    if speaker not in MODELS:
        raise CLIError("Piper français : choisissez --speaker Tom ou Pierre.")
    name, speaker_name = MODELS[speaker]
    path = Path(model).resolve() if model else CACHE / f"{name}.onnx"
    config_path = Path(str(path) + ".json")
    if not path.is_file() or not config_path.is_file():
        raise CLIError("Poids Piper manquants : make cli-piper-setup.")
    config = read_json(config_path)
    if config.get("language", {}).get("code") != "fr_FR":
        raise CLIError("Le modèle Piper doit être français (fr_FR).")
    speaker_id = config.get("speaker_id_map", {}).get(speaker_name) if speaker_name else None
    if speaker_name and speaker_id is None:
        raise CLIError("Le modèle Piper ne contient pas la voix Pierre.")
    return path, config_path, speaker_id


class PiperFrenchVoice:
    def __init__(self, backend, model, speaker, reference, max_tokens):
        if backend != "onnx" or reference:
            raise CLIError("Piper utilise ONNX CPU, sans clonage.")
        try:
            import onnxruntime as ort
            from piper import PiperVoice, SynthesisConfig
            from piper.config import PiperConfig
        except ImportError as exc:
            raise CLIError("Dépendances Piper manquantes : make cli-piper-setup puis make cli-piper.") from exc
        path, config, speaker_id = assets(speaker, model)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
        self.voice = PiperVoice(session=session, config=PiperConfig.from_dict(read_json(config)))
        # Keep the voice's normal speaking style/rate. Fit the assembled paragraph
        # once afterwards, rather than imposing a different speed per sentence.
        self.config = SynthesisConfig(speaker_id=speaker_id)

    def generate(self, text, output):
        with wave.open(str(output), "wb") as handle:
            self.voice.synthesize_wav(text, handle, syn_config=self.config)
        with wave.open(str(output), "rb") as handle:
            if not handle.getnframes():
                raise CLIError("Piper a produit un paragraphe vide.")
