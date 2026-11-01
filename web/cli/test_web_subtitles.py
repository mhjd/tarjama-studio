import copy
import argparse
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from retime_video import timeline
from tts_export import Paragraph
from web_subtitles import remap_segments, write_web_subtitles, voice_timed_segments
from workspace import CLIError, write_json
from main import preview_command


class WebSubtitleTests(unittest.TestCase):
    def test_audio_caption_mode_uses_local_pauses_and_keeps_provenance(self):
        project = self.project()
        group = Paragraph(["a", "b"], 1000, 5000, "Bonjour. La suite.")
        pieces, mapped, _ = timeline([group], [5], 5000, 30)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_json(root / "project.json", project)
            (root / "web/.cache").mkdir(parents=True)
            (root / "web/.cache/local-api").write_bytes(b"fixture")
            response = SimpleNamespace(returncode=0, stdout=json.dumps({"result": {"ass": "ASS", "srt": "SRT"}}))
            with patch("web_subtitles.subprocess.run", return_value=response) as bridge, \
                    patch("web_subtitles.file_hash", return_value="fixture"), patch("web_subtitles.ROOT", root):
                result = write_web_subtitles(root, "test", [group], pieces, root, 1920, 1080,
                    mapped_groups=mapped, natural_seconds=[5], audio_pause_regions=[[(0, 2400), (2800, 5000)]])
            self.assertIn("<=600ms", result["timing"])
            self.assertTrue((root / "subtitle-pause-anchors.json").is_file())
            sent = json.loads(bridge.call_args.kwargs["input"])["segments"]
            self.assertEqual([r["id"] for r in sent], ["a", "b"])
            self.assertLessEqual(sent[0]["end_ms"], sent[1]["start_ms"])

    def test_limited_preview_can_mix_existing_retimed_inputs_without_full_master(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("retimed-source.mkv", "voice.wav", "mix.ffscript", "timing.json"):
                (root / name).write_text("fixture")
            commands = []
            def fake_run(command, **kwargs):
                commands.append(command)
                (root / "audit-first-900s.partial.mp4").write_bytes(b"fixture")
            with patch("main.run", side_effect=fake_run):
                preview_command(argparse.Namespace(export=root, credits_file=None, seconds=900, retimed_input=True))
            self.assertTrue((root / "audit-first-900s.mp4").is_file())
            self.assertFalse((root / "export.mkv").exists())
            self.assertIn("mix.ffscript", commands[0])
            self.assertIn("[mix]", commands[0])
            self.assertEqual(commands[0][commands[0].index("-t") + 1], "900")
            self.assertIn("ass=subtitles.ass", commands[0])

    def test_voice_timing_uses_text_weights_and_resets_after_every_pause(self):
        rows = [{"id": "a", "french": "aaa"}, {"id": "b", "french": "bbbbbbbbb"},
                {"id": "c", "french": "..."}]
        before = copy.deepcopy(rows)
        groups = [Paragraph(["a", "b"], 0, 1000, ""), Paragraph(["c"], 1000, 2000, "")]
        mapped = [Paragraph(["a", "b"], 10000, 15000, ""), Paragraph(["c"], 20000, 22000, "")]
        result, anchors = voice_timed_segments(rows, groups, mapped, [3, 1], [[(500, 2500)], [(0, 1000)]])
        self.assertEqual((result[0]["start_ms"], result[0]["end_ms"]), (10850, 11350))
        self.assertEqual((result[1]["start_ms"], result[1]["end_ms"]), (11350, 12850))
        self.assertEqual(result[2]["start_ms"], 20200)
        self.assertEqual(result[2]["end_ms"], 21200)
        self.assertEqual(anchors[0]["end_ms"], result[1]["end_ms"])
        self.assertEqual(rows, before)

    def test_voice_timing_cannot_accumulate_drift_over_many_takes(self):
        rows, groups, mapped = [], [], []
        for i in range(200):
            ids = [f"{i}a", f"{i}b", f"{i}c"]
            rows.extend({"id": sid, "french": "Texte." * (n + 1)} for n, sid in enumerate(ids))
            groups.append(Paragraph(ids, i * 1000, (i + 1) * 1000, ""))
            mapped.append(Paragraph(ids, i * 30000, i * 30000 + 20000, ""))
        result, anchors = voice_timed_segments(rows, groups, mapped, [18.123] * 200)
        for i, anchor in enumerate(anchors):
            subset = result[i * 3:i * 3 + 3]
            self.assertEqual(subset[0]["start_ms"], i * 30000 + 350)
            self.assertEqual(subset[-1]["end_ms"], i * 30000 + 18473)
            self.assertTrue(all(s["end_ms"] > s["start_ms"] for s in subset))
            self.assertTrue(all(a["end_ms"] == b["start_ms"] for a, b in zip(subset, subset[1:])))
        with self.assertRaises(CLIError):
            voice_timed_segments(rows[:3], groups[:1], mapped[:1], [float("nan")])

    def test_retimed_preview_burns_short_ass_into_mp4(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "export.mkv").write_bytes(b"fixture")
            (root / "credits.txt").write_text("Voix synthétique, référence CC BY 4.0.")
            write_json(root / "timing.json", {})
            commands = []
            def fake_run(command, **kwargs):
                commands.append(command)
                (root / "audit.partial.mp4").write_bytes(b"fixture")
            with patch("main.run", side_effect=fake_run):
                preview_command(argparse.Namespace(export=root, credits_file=root / "credits.txt"))
            self.assertIn("ass=subtitles.ass", commands[0])
            self.assertIn("comment=Voix synthétique, référence CC BY 4.0.", commands[0])
            self.assertTrue((root / "audit.mp4").is_file())

    def project(self):
        return {"id": "test", "duration_ms": 5000, "segments": [
            {"id": "a", "start_ms": 1000, "end_ms": 2500, "arabic": "نص", "french": "Bonjour."},
            {"id": "b", "start_ms": 2500, "end_ms": 5000, "arabic": "نص", "french": "La suite."}]}

    def test_segment_cues_stay_separate_inside_tts_paragraph_and_source_is_intact(self):
        project = self.project()
        before = copy.deepcopy(project)
        groups = [Paragraph(["a", "b"], 1000, 5000, "Bonjour. La suite.")]
        pieces, _, _ = timeline(groups, [6], 5000, 24, intro_ends={0: 2000})
        mapped = remap_segments(project, groups, pieces)
        self.assertEqual(len(mapped), 2)
        self.assertEqual([s["french"] for s in mapped], ["Bonjour.", "La suite."])
        self.assertEqual(mapped[0]["start_ms"], 1000)
        self.assertEqual(mapped[0]["end_ms"], mapped[1]["start_ms"])
        self.assertEqual(mapped[1]["end_ms"], pieces[-1]["output_end_ms"])
        self.assertEqual(project, before)
        for field, value in [("french", "Texte modifié."), ("id", "other"), ("start_ms", 1100)]:
            changed = copy.deepcopy(project)
            changed["segments"][0][field] = value
            with self.assertRaises(CLIError):
                remap_segments(changed, groups, pieces)

    def test_calls_actual_bridge_without_api_and_writes_only_web_cues(self):
        project = self.project()
        groups = [Paragraph(["a", "b"], 1000, 5000, "Bonjour. La suite.")]
        pieces, _, _ = timeline(groups, [6], 5000, 24)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            write_json(root / "project.json", project)
            response = SimpleNamespace(returncode=0, stdout=json.dumps({"result": {"ass": "ASS fixture", "srt": "SRT fixture"}}))
            with patch("web_subtitles.subprocess.run", return_value=response) as call, \
                    patch("web_subtitles.file_hash", return_value="fixture"):
                # The compiled bridge is supplied by make cli-api-build in real use.
                with patch("pathlib.Path.is_file", return_value=True):
                    result = write_web_subtitles(root, "test", groups, pieces, root, 1080, 1920)
            request = json.loads(call.call_args.kwargs["input"])
            self.assertEqual(request["kind"], "subtitles")
            self.assertEqual(len(request["segments"]), 2)
            self.assertEqual((root / "subtitles.ass").read_text(), "ASS fixture")
            self.assertEqual(result["mode"], "web-segments")
