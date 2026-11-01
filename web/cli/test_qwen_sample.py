from pathlib import Path
import tempfile
import unittest
import wave
from unittest.mock import patch
import qwen_sample

from qwen_sample import generate_raw, sample_plan, reuse_raw_prefix
from retime_video import retime
from tts_export import file_hash
from workspace import CLIError, read_json, write_json


class QwenSampleTests(unittest.TestCase):
    def test_batch_resume_preserves_completed_takes_and_records_shared_seed(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "raw"
            plan = {"backend": "mlx", "model": "test", "max_tokens": 2048,
                    "reference_text": "Référence.", "sampling": {"temperature": .3},
                    "seed_per_paragraph": [10, 11, 12, 13, 14],
                    "paragraphs": [{"text": f"Texte {i}."} for i in range(5)]}
            calls, seeds = [], []
            class Voice:
                def __init__(self, *args, **kwargs):
                    pass
                def generate(self, text, target):
                    calls.append(text)
                    with wave.open(str(target), "wb") as handle:
                        handle.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
                        handle.writeframes(b"\x01\0" * 2400)
                def generate_batch(self, texts, targets):
                    for text, target in zip(texts, targets):
                        self.generate(text, target)
            output.mkdir()
            write_json(output / "plan.json", plan)
            Voice().generate("Déjà terminé.", output / "0000-raw.wav")
            digest = file_hash(output / "0000-raw.wav")
            write_json(output / "0000.json", {"raw_sha256": digest, "seed": 10})
            calls.clear()
            progress=[]
            def observed(done,total):
                self.assertEqual(len(list(output.glob("[0-9][0-9][0-9][0-9].json"))),done)
                progress.append((done,total))
            generate_raw(plan, output, Path("reference.wav"), resume=True, batch_size=4,
                         voice_factory=Voice, seed_func=seeds.append,on_progress=observed)
            self.assertEqual(progress,[(1,5),(5,5)])
            self.assertEqual(len(calls), 4)
            self.assertEqual(seeds, [11])
            self.assertEqual(read_json(output / "0000.json"), {"raw_sha256": digest, "seed": 10})
            for i in range(1, 5):
                marker = read_json(output / f"{i:04d}.json")
                self.assertEqual(marker["seed"], 11)
                self.assertEqual(marker["generation_batch_indices"], [1, 2, 3, 4])
                self.assertIn("shared_batch", marker["seed_scope"])
            self.assertEqual(len(read_json(output / "raw-complete.json")["raw_sha256"]), 5)
            generate_raw(plan, output, Path("reference.wav"), resume=True, batch_size=2,
                         voice_factory=Voice, seed_func=seeds.append)
            self.assertEqual(len(calls), 4)

    def test_raw_only_never_creates_redundant_video_render(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.txt"
            reference.write_text("Référence de test.")
            args = ["sample", "--export", str(root), "--reference-audio", str(root / "reference.wav"),
                    "--reference-text", str(reference), "--output", str(root / "output"),
                    "--temperature", "0.3", "--raw-only"]
            with patch("sys.argv", args), patch.object(qwen_sample, "sample_plan", return_value={}), \
                    patch.object(qwen_sample, "generate_raw") as generate, patch.object(qwen_sample, "retime") as render:
                qwen_sample.main()
            generate.assert_called_once()
            render.assert_not_called()

    def test_plan_records_exact_sampling_seed_reference_and_source_cut(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video, reference = root / "video.mp4", root / "reference.wav"
            video.write_bytes(b"video fixture")
            reference.write_bytes(b"reference fixture")
            write_json(root / "plan.json", {"project_id": "test", "video": str(video), "video_sha256": file_hash(video),
                       "media": {"duration_ms": 400000}, "bed_db": -18, "paragraphs": [
                       {"ids": ["a"], "start_ms": 0, "end_ms": 317140, "text": "Allah et la jahiliyya."},
                       {"ids": ["b"], "start_ms": 317140, "end_ms": 390000, "text": "Après."}]})
            plan = sample_plan(root, reference, "Référence française.", .5, 300, 20261017)
            self.assertEqual(plan["sampling"]["temperature"], .5)
            self.assertEqual(plan["seed_per_paragraph"], [20261017])
            self.assertEqual(plan["source_end_ms"], 317140)
            self.assertEqual(plan["reference_sha256"], file_hash(reference))
            self.assertEqual(len(plan["paragraphs"]), 1)
            self.assertTrue(plan["new_generation"])
            designed = sample_plan(root, None, "", .3, 300, 20261017,
                                   voice_description="French male lecturer, calm and articulate.", repetition_penalty=1.5)
            self.assertIn("VoiceDesign", designed["model"])
            self.assertIsNone(designed["reference_sha256"])
            self.assertIsNone(designed["reference_text"])
            self.assertTrue(designed["voice_design"])
            self.assertEqual(designed["sampling"]["repetition_penalty"], 1.5)
            self.assertIsNone(designed["effective_mlx_icl_repetition_penalty"])
            with self.assertRaises(CLIError):
                sample_plan(root, None, "", .3, 300, 1, voice_description="Design.", repetition_penalty=float("nan"))
            with self.assertRaises(CLIError):
                sample_plan(root, reference, "Référence.", .3, 300, 1, voice_description="Design.")

    def test_new_raw_cache_passes_sampling_and_resumes_only_matching_plan(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "raw"
            plan = {"backend": "mlx", "model": "test", "max_tokens": 2048,
                    "reference_text": "Référence.", "sampling": {"temperature": .5},
                    "seed_per_paragraph": [20261017], "paragraphs": [{"text": "Allah."}]}
            calls, seeds = [], []
            class Voice:
                def __init__(self, *args, **kwargs):
                    calls.append(kwargs)
                def generate(self, text, target):
                    with wave.open(str(target), "wb") as handle:
                        handle.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
                        handle.writeframes(b"\x01\0" * 2400)
            generate_raw(plan, output, Path("reference.wav"), voice_factory=Voice, seed_func=seeds.append)
            self.assertEqual(calls[0]["sampling"], {"temperature": .5})
            self.assertEqual(seeds, [20261017])
            completed = read_json(output / "raw-complete.json")
            self.assertEqual(completed["plan_sha256"], file_hash(output / "plan.json"))
            self.assertEqual(completed["raw_sha256"], [file_hash(output / "0000-raw.wav")])
            extended = dict(plan, paragraphs=plan["paragraphs"] + [{"text": "Suite."}], seed_per_paragraph=[20261017, 20261018])
            target = output.parent / "extended"
            reuse_raw_prefix(extended, target, output)
            self.assertEqual(file_hash(target / "0000-raw.wav"), completed["raw_sha256"][0])
            self.assertEqual(read_json(target / "reuse.json")["count"], 1)
            with self.assertRaises(CLIError):
                reuse_raw_prefix(dict(extended, sampling={"temperature": .1}), output.parent / "invalid", output)
            generate_raw(plan, output, Path("reference.wav"), resume=True, voice_factory=Voice, seed_func=seeds.append)
            self.assertEqual(len(calls), 1)
            with self.assertRaises(CLIError):
                generate_raw(dict(plan, sampling={"temperature": .9}), output, Path("reference.wav"), resume=True)
            # A raw cache cannot be used with a changed generation plan.
            write_json(output / "plan.json", dict(plan, sampling={"temperature": .9}))
            with self.assertRaisesRegex(CLIError, "plan"):
                retime(output, output.parent / "video")

    def test_design_generation_passes_description_without_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            plan = {"backend": "mlx", "model": "VoiceDesign", "max_tokens": 2048,
                    "reference_text": None, "sampling": {"temperature": .3}, "voice_design": True,
                    "voice_description": "French male lecturer.", "seed_per_paragraph": [1],
                    "paragraphs": [{"text": "Texte de test."}]}
            calls = []
            class Voice:
                def __init__(self, *args, **kwargs):
                    calls.append((args, kwargs))
                def generate(self, text, target):
                    with wave.open(str(target), "wb") as handle:
                        handle.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
                        handle.writeframes(b"\0\0" * 2400)
            generate_raw(plan, Path(directory) / "raw", None, voice_factory=Voice, seed_func=lambda _: None)
            self.assertIsNone(calls[0][0][3])
            self.assertEqual(calls[0][1]["description"], plan["voice_description"])
            self.assertIsNone(calls[0][1]["reference_text"])
