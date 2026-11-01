import contextlib
from pathlib import Path
from types import SimpleNamespace
import tempfile
import threading
import unittest
from unittest.mock import patch
import wave

from pocket_sample import natural_audio
from pocket_voice import PocketFrenchVoice, assets
from tts_export import export
from workspace import CLIError


class PocketTests(unittest.TestCase):
    def test_real_torch_cache_can_be_updated_by_worker_thread(self):
        try:
            import torch
        except ImportError:
            self.skipTest("Exécuter aussi avec .venv-pocket pour le test des threads PyTorch")
        voice = object.__new__(PocketFrenchVoice)
        voice.torch, voice.state = torch, object()
        errors, written = [], []
        def generate(state, text, **kwargs):
            cache = torch.zeros(2400)
            def worker():
                try:
                    cache.fill_(0.2)
                except Exception as exc:
                    errors.append(exc)
            thread = threading.Thread(target=worker)
            thread.start()
            thread.join()
            if errors:
                raise errors[0]
            return cache
        voice.model = SimpleNamespace(generate_audio=generate, sample_rate=24000)
        voice.sf = SimpleNamespace(write=lambda *args, **kwargs: written.append(args))
        voice.generate("Une conférence française.", Path("unused.wav"))
        self.assertEqual(len(written), 1)
        self.assertFalse(errors)

    def test_french_preset_and_incompatible_options_are_explicit(self):
        for model, voice in (("english", "estelle"), ("french_24l", "alba")):
            with self.assertRaisesRegex(CLIError, "french_24l"):
                assets(model, voice)
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "output"
            for options in ({"clone_source": True}, {"voice_design": True}, {"backend": "mlx"}, {"batch_size": 2}):
                with self.assertRaisesRegex(CLIError, "Pocket"):
                    export({}, None, output, engine="pocket", **options)
            self.assertFalse(output.exists())

    def test_generation_preserves_input_and_copies_preset_state(self):
        voice = object.__new__(PocketFrenchVoice)
        seeds, calls, written = [], [], []
        # Deliberately expose no inference_mode: Pocket's worker threads must
        # receive ordinary cache tensors, not main-thread inference-only tensors.
        voice.torch = SimpleNamespace(manual_seed=seeds.append, no_grad=contextlib.nullcontext)
        audio = SimpleNamespace(detach=lambda: SimpleNamespace(cpu=lambda: SimpleNamespace(numpy=lambda: [0.2] * 100)))
        voice.state = object()
        def generate(state, text, **kwargs):
            calls.append((state, text, kwargs))
            return audio
        voice.model = SimpleNamespace(generate_audio=generate, sample_rate=24000)
        voice.sf = SimpleNamespace(write=lambda *args, **kwargs: written.append((args, kwargs)))
        numpy = SimpleNamespace(isfinite=lambda value: SimpleNamespace(all=lambda: True), any=lambda value: True)
        with patch.dict("sys.modules", {"numpy": numpy}):
            voice.generate("Allah, une conférence française.", Path("voice.wav"))
            voice.generate("Allah, une conférence française.", Path("other.wav"))
        self.assertEqual(seeds[0], seeds[1])
        self.assertIs(calls[0][0], voice.state)
        self.assertEqual(calls[0][1], "Allah, une conférence française.")
        self.assertEqual(calls[0][2], {"max_tokens": 50, "copy_state": True})
        self.assertEqual(written[0][0][2], 24000)

    def test_natural_audio_keeps_samples_without_time_stretch(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            for index in range(2):
                with wave.open(str(directory / f"{index:04d}-raw.wav"), "wb") as handle:
                    handle.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
                    handle.writeframes(bytes([index + 1, 0]) * 2400)
            target = natural_audio(directory, 2)
            with wave.open(str(target), "rb") as handle:
                self.assertEqual(handle.getnframes(), 2400 * 2 + 4800)
                self.assertEqual(handle.readframes(2400), b"\x01\0" * 2400)
                self.assertEqual(handle.readframes(4800), b"\0\0" * 4800)
                self.assertEqual(handle.readframes(2400), b"\x02\0" * 2400)
