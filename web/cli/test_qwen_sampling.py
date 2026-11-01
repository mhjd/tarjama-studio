from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from qwen_voice import QwenVoice


class SamplingTests(unittest.TestCase):
    def test_temperature_controls_reach_mlx_without_changing_input(self):
        voice = object.__new__(QwenVoice)
        voice.backend, voice.reference = "mlx", Path("reference.wav")
        voice.reference_text, voice.max_tokens = "Texte français de référence.", 2048
        voice.sampling = {"temperature": .35, "top_p": 1.0, "top_k": 50, "repetition_penalty": 1.05}
        calls, written = [], []
        def generate(**kwargs):
            calls.append(kwargs)
            yield SimpleNamespace(token_count=12, audio=[.1] * 2400, sample_rate=24000)
        voice.model = SimpleNamespace(generate=generate)
        voice.sf = SimpleNamespace(write=lambda *args, **kwargs: written.append(args))
        with patch.dict("sys.modules", {"numpy": SimpleNamespace(asarray=lambda value: value)}):
            voice.generate("Allah et la jahiliyya.", Path("unused.wav"))
        self.assertEqual(calls[0]["text"], "Allah et la jahiliyya.")
        self.assertEqual(calls[0]["lang_code"], "French")
        for key, value in voice.sampling.items():
            self.assertEqual(calls[0][key], value)
        self.assertEqual(len(written), 1)
