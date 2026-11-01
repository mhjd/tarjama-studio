import copy
import unittest

from canary_alignment import absolute_words, compare_with_full_context, matched_rows, windows
from tts_export import Paragraph, voice_slot
from workspace import CLIError


class CanaryTimingTests(unittest.TestCase):
    def test_evaluation_keeps_full_text_context_when_a_cue_is_missing(self):
        context = [{"id": str(i), "french": text, "start_ms": i * 3000, "end_ms": i * 3000 + 2000}
                   for i, text in enumerate(("Voici les premières paroles", "Une phrase répétée ici", "Voici les premières paroles"))]
        words = [{"word": word, "start": i * 3 + j * .4, "end": i * 3 + j * .4 + .3}
                 for i, row in enumerate(context) for j, word in enumerate(row["french"].split())]
        selected = [dict(context[2], start_ms=6100, end_ms=7600)]
        result = compare_with_full_context(selected, context, words, 10)
        self.assertEqual(result["summary"]["measured_cues"], 1)
        self.assertEqual(result["cue_deltas"][0]["start_delta_ms"], 100)
        self.assertLess(result["summary"]["boundary_abs_max_ms"], 500)

    def test_quantization_never_crosses_the_real_analysis_window(self):
        words = absolute_words([{"word": "fin", "start": 9.7, "end": 10.005}], 8.455, 18.455)
        self.assertEqual(words[0]["end"], 18.455)
        with self.assertRaises(CLIError):
            absolute_words([{"word": "fin", "start": 9.7, "end": 11}], 0, 10)

    def test_exact_endpoints_preserve_text_and_reset_at_each_take(self):
        rows = [{"id": "a", "french": "Voici les premières paroles.", "start_ms": 0, "end_ms": 2000},
                {"id": "b", "french": "Puis les paroles suivantes.", "start_ms": 2000, "end_ms": 4000}]
        original = copy.deepcopy(rows)
        words = [{"word": word, "start": .1 + i * .3, "end": .3 + i * .3}
                 for i, word in enumerate("Voici les premières paroles Puis les paroles suivantes".split())]
        for offset in (0, 10000, 900000):
            group = Paragraph(["a", "b"], offset, offset + 5000, "")
            result, missing, _ = matched_rows(rows, group, group, words, 4)
            self.assertEqual(missing, [])
            self.assertEqual(result[0]["start_ms"], voice_slot(group)[0] + 100)
            self.assertEqual(result[1]["end_ms"], voice_slot(group)[0] + 2400)
            self.assertEqual([r["french"] for r in result], [r["french"] for r in original])
        self.assertEqual(rows, original)

    def test_missing_endpoint_is_reported_not_guessed(self):
        rows = [{"id": "a", "french": "Voici les premières paroles.", "start_ms": 0, "end_ms": 2000}]
        group = Paragraph(["a"], 0, 5000, "")
        words = [{"word": word, "start": i * .3, "end": .2 + i * .3}
                 for i, word in enumerate("Voici les premières AUTRE".split())]
        result, missing, _ = matched_rows(rows, group, group, words, 4)
        self.assertEqual(result, [])
        self.assertEqual(missing, ["a"])

    def test_analysis_windows_have_no_gaps_overlap_or_long_inputs(self):
        result = windows(31.2, [(0, 8500), (9000, 18000), (18500, 31000)])
        self.assertEqual(result[0], (0, 8.75))
        self.assertEqual(result[-1][1], 31.2)
        self.assertTrue(all(0 < b - a <= 10 for a, b in result))
        self.assertTrue(all(a[1] == b[0] for a, b in zip(result, result[1:])))

    def test_context_never_makes_analysis_longer_than_ten_seconds(self):
        for context in (0, 1, 2):
            cores = windows(31.2, [(0, 8500), (9000, 31000)], 10 - 2 * context)
            self.assertEqual(cores[0][0], 0)
            self.assertEqual(cores[-1][1], 31.2)
            for a, b in cores:
                self.assertLessEqual(min(31.2, b + context) - max(0, a - context), 10.00001)
            self.assertTrue(all(a[1] == b[0] for a, b in zip(cores, cores[1:])))
