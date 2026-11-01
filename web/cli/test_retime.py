import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

import retime_video
from retime_video import concatenate_pieces, limit_source, retime, timeline
from tts_export import Paragraph, export, file_hash, probe, run
from workspace import CLIError, read_json


class RetimeTests(unittest.TestCase):
    def test_concat_uses_explicit_frame_durations_not_rounded_container_lengths(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            def fake_run(command, **kwargs):
                (output / "retimed-source.partial.mkv").write_bytes(b"derived fixture")
            with patch.object(retime_video, "run", side_effect=fake_run):
                concatenate_pieces(output, [{"frames": 24}, {"frames": 48}], "24000/1001")
            listing = (output / "pieces.txt").read_text()
            self.assertIn("duration 1.001000000000", listing)
            self.assertIn("duration 2.002000000000", listing)
            self.assertTrue((output / "retimed-source.mkv").is_file())
            self.assertFalse((output / "retimed-source.partial.mkv").exists())

    def test_source_limit_finishes_paragraph_without_mutating_timestamps(self):
        groups = [Paragraph(["a"], 0, 700000, "Première phrase."),
                  Paragraph(["b"], 700000, 908140, "Fin du paragraphe."),
                  Paragraph(["c"], 908140, 950700, "Après.")]
        selected, end = limit_source(groups, 1000000, 900)
        self.assertEqual(selected, groups[:2])
        self.assertEqual(end, 908140)
        self.assertEqual(len(groups), 3)
        self.assertEqual(groups[2].start_ms, 908140)
        self.assertEqual(limit_source(groups, 1000000, None), (groups, 1000000))
        for seconds in (0, -1, math.nan, math.inf):
            with self.assertRaises(CLIError):
                limit_source(groups, 1000000, seconds)

    def test_mapping_covers_source_preserves_gaps_and_natural_voice_room(self):
        groups = [Paragraph(["a"], 1000, 4000, "Bonjour."), Paragraph(["b"], 5000, 7000, "Encore.")]
        pieces, mapped, duration = timeline(groups, [1.5, 3], 8000, 24)
        self.assertEqual([(p["source_start_ms"], p["source_end_ms"]) for p in pieces],
                         [(0, 1000), (1000, 4000), (4000, 5000), (5000, 7000), (7000, 8000)])
        self.assertEqual([p["source_speed"] for p in pieces if p["paragraph"] is None], [1, 1, 1])
        self.assertGreaterEqual(mapped[0].end_ms - mapped[0].start_ms, 2050)
        self.assertGreaterEqual(mapped[1].end_ms - mapped[1].start_ms, 3550)
        self.assertEqual(mapped[1].start_ms - mapped[0].end_ms, 1000)
        self.assertEqual(mapped[0].text, groups[0].text)
        self.assertEqual(mapped[1].ids, ["b"])
        self.assertEqual(duration, pieces[-1]["output_end_ms"])

    def test_invalid_and_overlapping_intervals_are_rejected(self):
        with self.assertRaises(CLIError):
            timeline([Paragraph(["a"], 0, 1000, "Texte.")], [math.nan], 1000, 24)
        with self.assertRaises(CLIError):
            timeline([Paragraph(["a"], 0, 1100, "Texte.")], [1], 1000, 24)

    def test_real_export_retimes_original_only_and_preserves_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "source.mp4"
            run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12:duration=3",
                 "-f", "lavfi", "-i", "sine=frequency=220:duration=3", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(video)])
            class Voice:
                def __init__(self, *args, **kwargs):
                    pass
                def generate(self, text, output):
                    run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i",
                         "sine=frequency=880:duration=0.6", "-ar", "24000", "-c:a", "pcm_s16le", str(output)])
            project = {"id": "test", "segments": [
                {"id": "a", "start_ms": 100, "end_ms": 1200, "arabic": "نص", "french": "Bonjour."},
                {"id": "b", "start_ms": 1400, "end_ms": 2800, "arabic": "نص", "french": "Encore."}]}
            source = root / "tts"
            export(project, video, source, voice_factory=Voice, copy_video=True, target_seconds=1)
            before = (file_hash(video), file_hash(source / "0000-raw.wav"))
            commands = []
            def spy(command, **kwargs):
                commands.append(command)
                return run(command, **kwargs)
            with patch.object(retime_video, "run", side_effect=spy):
                output = retime(source, root / "retimed")
            timing = read_json(output.parent / "timing.json")
            self.assertLess(abs(probe(output)["duration_ms"] - timing["duration_ms"]), 90)
            self.assertEqual(before, (file_hash(video), file_hash(source / "0000-raw.wav")))
            voice_filters = [c[c.index("-af") + 1] for c in commands if "-af" in c]
            self.assertEqual(len(voice_filters), 2)
            self.assertTrue(all("atempo" not in f for f in voice_filters))
            self.assertTrue(any("atempo=" in " ".join(c) for c in commands))
            self.assertEqual(timing["french_speed"], 1)
            self.assertEqual(read_json(output.parent / "result.json")["output_sha256"], file_hash(output))
            def detected(media, wav, **kwargs):
                return [(200, 1200), (1500, 2800)] if wav.name == "source.wav" else [(0, 500)]
            with patch("speech_mix.detect_speech", side_effect=detected):
                documentary = retime(source, root / "documentary", speech_intro=True, lean=True)
            analysis = read_json(documentary.parent / "speech-mix.json")
            self.assertEqual(analysis["bed_db"], -28)
            self.assertEqual(len(analysis["introductions"]), 1)
            self.assertEqual(analysis["introductions"][0]["speech_start_ms"], 200)
            self.assertTrue(analysis["duck_windows_ms"])
            self.assertEqual(before, (file_hash(video), file_hash(source / "0000-raw.wav")))
            self.assertTrue((documentary.parent / "retimed-source.mkv").is_file())
            self.assertFalse((documentary.parent / "mix.wav").exists())
            self.assertFalse(list(documentary.parent.glob("*-fitted.wav")))
            self.assertFalse(list(documentary.parent.glob("piece-*.mkv")))
            with self.assertRaises(CLIError):
                retime(source, output.parent)
