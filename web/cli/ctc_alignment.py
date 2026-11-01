"""Small French acoustic aligner using the installed TorchAudio API.

Based on the official CTC forced alignment tutorial:
https://docs.pytorch.org/audio/2.8/tutorials/ctc_forced_alignment_api_tutorial.html
No decoding, translation, dictionary download or rewritten subtitle text.
"""
from pathlib import Path
import re
import unicodedata

from tts_export import file_hash, run
from workspace import CLIError


def acoustic_words(text, labels):
    result = []
    for match in re.finditer(r"\w+(?:['’\-]\w+)*", text, re.UNICODE):
        original = match.group()
        letters = []
        for char in unicodedata.normalize("NFC", original.casefold()):
            if char in "'’-":
                continue
            if char in labels:
                letters.append(char)
            else:
                base = "".join(c for c in unicodedata.normalize("NFKD", char) if not unicodedata.combining(c))
                if not base or any(c not in labels for c in base):
                    raise CLIError("Mot hors alphabet acoustique français : alignement à vérifier, texte conservé.")
                letters.extend(base)
        if not letters:
            raise CLIError("Mot sans caractère acoustique alignable.")
        result.append((original, letters))
    return result


class FrenchCTCAligner:
    def __init__(self):
        import torch
        import torchaudio
        self.torch, self.functional = torch, torchaudio.functional
        self.bundle = torchaudio.pipelines.VOXPOPULI_ASR_BASE_10K_FR
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.model = self.bundle.get_model(dl_kwargs={"progress": False}).to(self.device).eval()
        self.labels = {c: i for i, c in enumerate(self.bundle.get_labels())}
        self.path = Path(torch.hub.get_dir()) / "checkpoints" / self.bundle._path
        self.model_hashes = {self.path.name: file_hash(self.path)}

    def align(self, audio, text, analysis, duration):
        import numpy as np
        import wave
        torch = self.torch
        run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(audio), "-ar", "16000", "-ac", "1",
             "-c:a", "pcm_s16le", str(analysis)])
        with wave.open(str(analysis)) as wav:
            samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768
        words = acoustic_words(text, self.labels)
        targets, offsets = [], []
        for word, letters in words:
            start = len(targets)
            targets.extend(self.labels[c] for c in letters)
            offsets.append((start, len(targets)))
            targets.append(self.labels["|"])
        targets.pop()
        with torch.inference_mode():
            emissions, _ = self.model(torch.from_numpy(samples).unsqueeze(0).to(self.device))
        log_probs = emissions.log_softmax(-1).cpu()
        aligned, scores = self.functional.forced_align(log_probs, torch.tensor([targets]), blank=0)
        spans = self.functional.merge_tokens(aligned[0], scores[0].exp(), blank=0)
        if len(spans) != len(targets) or any(span.token != token for span, token in zip(spans, targets)):
            raise CLIError("Chemin acoustique incomplet : aucun sous-titre remplacé.")
        seconds_per_frame = len(samples) / 16000 / emissions.shape[1]
        return {"analysis_seconds": len(samples) / 16000, "analysis_speed": 1, "device": self.device,
                "words": [{"word": word, "start": spans[a].start * seconds_per_frame,
                           "end": spans[b - 1].end * seconds_per_frame,
                           "probability": sum(float(s.score) for s in spans[a:b]) / (b - a)}
                          for (word, _), (a, b) in zip(words, offsets)]}
