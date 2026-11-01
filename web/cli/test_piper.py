import copy
from pathlib import Path
import tempfile
import unittest

from piper_compare import sample_project
from piper_voice import assets
from tts_export import export
from workspace import CLIError, write_json


class PiperTests(unittest.TestCase):
    def test_sample_finishes_sentence_and_does_not_mutate_source(self):
        original = {"id": "test", "segments": [
            {"id": "1", "start_ms": 0, "end_ms": 299000, "french": "Une phrase."},
            {"id": "2", "start_ms": 299000, "end_ms": 301000, "french": "La suite"},
            {"id": "3", "start_ms": 301000, "end_ms": 304000, "french": "se termine ici."},
            {"id": "4", "start_ms": 304000, "end_ms": 310000, "french": "Après."}]}
        before = copy.deepcopy(original)
        sample = sample_project(original, 300)
        self.assertEqual(sample["duration_ms"], 304500)
        self.assertEqual(len(sample["segments"]), 3)
        self.assertEqual(original, before)

    def test_pierre_selects_male_speaker_and_requires_french(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "voice.onnx"
            model.touch()
            config = Path(str(model) + ".json")
            write_json(config, {"language": {"code": "fr_FR"}, "speaker_id_map": {"jessica": 0, "pierre": 1}})
            self.assertEqual(assets("Pierre", model)[2], 1)
            self.assertIsNone(assets("Tom", model)[2])
            write_json(config, {"language": {"code": "en_US"}})
            with self.assertRaisesRegex(CLIError, "français"):
                assets("Pierre", model)

    def test_piper_rejects_qwen_flags_before_creating_output(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "export"
            for options in ({"clone_source": True}, {"voice_design": True}, {"backend": "mlx"}, {"batch_size": 2}):
                with self.assertRaisesRegex(CLIError, "Piper"):
                    export({}, None, output, engine="piper", **options)
            self.assertFalse(output.exists())

    def test_adapter_passes_text_unchanged_with_selected_config(self):
        from piper_voice import PiperFrenchVoice
        voice = object.__new__(PiperFrenchVoice)
        voice.config = object()
        class FakeVoice:
            def synthesize_wav(self, text, handle, syn_config):
                self.text, self.config = text, syn_config
                handle.setparams((1, 2, 22050, 0, "NONE", "not compressed"))
                handle.writeframes(b"\x01\x00" * 2205)
        voice.voice = FakeVoice()
        with tempfile.TemporaryDirectory() as directory:
            voice.generate("Allah, une conférence française.", Path(directory) / "test.wav")
        self.assertEqual(voice.voice.text, "Allah, une conférence française.")
        self.assertIs(voice.voice.config, voice.config)

    def test_plan_records_piper_identity_and_rejects_changed_config(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / "voice.onnx"
            model.touch()
            config = Path(str(model) + ".json")
            write_json(config, {"language": {"code": "fr_FR"}})
            project = {"id": "test", "segments": [{"id": "1", "start_ms": 0, "end_ms": 1000,
                                                      "french": "Une phrase."}]}
            options = dict(engine="piper", speaker="Tom", model=str(model), plan_only=True)
            plan = export(project, None, root / "export", **options)
            self.assertEqual((plan["engine"], plan["backend"], plan["speaker"]), ("piper", "onnx", "Tom"))
            self.assertIsNone(plan["narration_style"])
            self.assertEqual(plan, export(project, None, root / "export", resume=True, **options))
            write_json(config, {"language": {"code": "fr_FR"}, "inference": {"length_scale": 1.2}})
            with self.assertRaisesRegex(CLIError, "réglages"):
                export(project, None, root / "export", resume=True, **options)
