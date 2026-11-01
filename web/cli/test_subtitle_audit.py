import unittest
from pathlib import Path
import tempfile

from audit_subtitle_timing import compare, tokens, read_srt
from workspace import CLIError


class SubtitleAuditTests(unittest.TestCase):
    def test_rendered_srt_and_isolated_bad_reference_points(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "captions.srt"
            path.write_text("1\n00:00:01,000 --> 00:00:04,500\nUn propos\nsimple et clair.\n")
            rows = read_srt(path)
            self.assertEqual(rows[0]["french"], "Un propos simple et clair.")
            self.assertEqual(rows[0]["end_ms"], 4500)
        words = [{"word": f"mot{i}", "start": i, "end": i + .5} for i in range(60)]
        words[30]["start"] = 28.9
        row = {"id": "cue", "french": " ".join(f"mot{i}" for i in range(5)), "start_ms": 0, "end_ms": 4500}
        result = compare([row], words, 60)
        self.assertEqual(result["summary"]["reference_words_excluded_for_bad_timing"], 2)
        self.assertEqual(result["summary"]["measured_cues"], 1)
        self.assertEqual(result["summary"]["boundary_abs_max_ms"], 0)

    def test_normalization_and_known_boundary_errors(self):
        self.assertEqual(tokens("L’ÉTÉ, c'est-à-dire !"), ["l", "ete", "c", "est", "a", "dire"])
        row = {"id": "cue", "french": "Un propos simple et clair.", "start_ms": 1200, "end_ms": 3600}
        words = [{"word": w, "start": 1 + i * .5, "end": 1.5 + i * .5}
                 for i, w in enumerate(tokens(row["french"]))]
        result = compare([row], words, 10)
        self.assertEqual(result["summary"]["matched_token_fraction"], 1)
        self.assertEqual(result["cue_deltas"][0]["start_delta_ms"], 200)
        self.assertEqual(result["cue_deltas"][0]["end_delta_ms"], 100)

    def test_bad_matches_are_not_reported_as_precise_and_bad_times_fail(self):
        row = {"id": "cue", "french": "Un propos simple et clair.", "start_ms": 1000, "end_ms": 3000}
        words = [{"word": "simple", "start": 1, "end": 2}]
        result = compare([row], words, 10)
        self.assertEqual(result["summary"]["measured_cues"], 0)
        self.assertIsNone(result["summary"]["boundary_abs_median_ms"])
        with self.assertRaises(CLIError):
            compare([row], [{"word": "mot", "start": 3, "end": 2}], 10)
