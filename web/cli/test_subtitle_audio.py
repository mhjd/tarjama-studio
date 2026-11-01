import copy
import math
from pathlib import Path
import struct
import tempfile
import unittest
import wave

from subtitle_audio import energy_regions, punctuation_pause_rows
from tts_export import Paragraph
from workspace import CLIError


class SubtitleAudioTests(unittest.TestCase):
    def test_real_audio_energy_finds_pause_and_ignores_silence(self):
        with tempfile.TemporaryDirectory() as directory:
            for rate in (16000, 24000):
                path = Path(directory) / f"{rate}.wav"
                with wave.open(str(path), "wb") as wav:
                    wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
                    samples = [int(5000 * math.sin(2 * math.pi * 220 * i / rate))
                               if .2 <= i / rate < .8 or 1.2 <= i / rate < 1.8 else 0 for i in range(rate * 2)]
                    wav.writeframes(struct.pack("<" + "h" * len(samples), *samples))
                self.assertEqual(energy_regions(path), [(200, 800), (1200, 1800)])
                with wave.open(str(path), "wb") as wav:
                    wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
                    wav.writeframes(b"\0\0" * rate)
                self.assertEqual(energy_regions(path), [])

    def test_pause_anchor_is_local_bounded_and_does_not_mutate_original(self):
        rows = [{"id": "a", "french": "aaaa.", "start_ms": 350, "end_ms": 2350},
                {"id": "b", "french": "bbbb.", "start_ms": 2350, "end_ms": 4350}]
        before = copy.deepcopy(rows)
        group = Paragraph(["a", "b"], 0, 5000, "")
        result, decisions = punctuation_pause_rows(rows, [group], [group], [[(0, 2100), (2500, 4000)]])
        self.assertEqual(result[0]["end_ms"], 2450)
        self.assertEqual(result[1]["start_ms"], 2850)
        self.assertEqual(result[0]["start_ms"], 350)
        self.assertEqual(result[-1]["end_ms"], 4350)
        self.assertTrue(decisions[0]["anchors"])
        self.assertEqual(rows, before)
        fallback, _ = punctuation_pause_rows(rows, [group], [group], [[(0, 3000), (3400, 4000)]])
        self.assertEqual(fallback, rows)

    def test_no_drift_over_many_paragraphs_and_empty_punctuation(self):
        rows, groups, speech = [], [], []
        for i in range(200):
            start = i * 10000
            group = Paragraph([f"{i}a", f"{i}b"], start, start + 5000, "")
            groups.append(group)
            rows.extend([{"id": group.ids[0], "french": "aaaa.", "start_ms": start + 350, "end_ms": start + 2350},
                         {"id": group.ids[1], "french": "bbbb.", "start_ms": start + 2350, "end_ms": start + 4350}])
            speech.append([(0, 2100), (2500, 4000)])
        result, _ = punctuation_pause_rows(rows, groups, groups, speech)
        self.assertTrue(all(0 < r["end_ms"] - r["start_ms"] for r in result))
        self.assertTrue(all(a["end_ms"] <= b["start_ms"] for a, b in zip(result, result[1:])))
        self.assertTrue(all(max(abs(a[k] - b[k]) for k in ("start_ms", "end_ms")) <= 600 for a, b in zip(rows, result)))
        self.assertTrue(all(result[i * 2]["start_ms"] == i * 10000 + 350 and result[i * 2 + 1]["end_ms"] == i * 10000 + 4350 for i in range(200)))
        rows[0]["french"] = "..."
        result, _ = punctuation_pause_rows(rows[:2], groups[:1], groups[:1], [[]])
        self.assertTrue(all(r["end_ms"] > r["start_ms"] for r in result))
        with self.assertRaises(CLIError):
            punctuation_pause_rows(rows, groups, groups, [])
