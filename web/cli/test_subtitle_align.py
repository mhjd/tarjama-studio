import copy
from pathlib import Path
import tempfile
import unittest

from align_subtitles import aligned_rows, readable_ends, align_export, speech_coverage
from tts_export import Paragraph
from workspace import CLIError
from ctc_alignment import acoustic_words


class SubtitleAlignmentTests(unittest.TestCase):
    def test_real_spoken_tail_remains_visible_without_moving_next_onset(self):
        rows = [{"id": "a", "french": "Un.", "start_ms": 500, "end_ms": 1000},
                {"id": "b", "french": "Deux.", "start_ms": 2000, "end_ms": 2500}]
        group = Paragraph(["a", "b"], 0, 5000, "")
        speech = [[(150, 1100), (1650, 2300)]]
        result = readable_ends(rows, [group], [group], speech)
        self.assertEqual(result[0]["end_ms"], 1510)
        self.assertEqual(result[1]["start_ms"], 2000)
        self.assertEqual(result[1]["end_ms"], 2710)
        coverage = speech_coverage(result, [group], [group], speech, 5)
        self.assertEqual(coverage["uncovered_ms"], 0)
        self.assertEqual(coverage["bursts_over200ms"], 0)

    def test_quiet_consonant_gap_near_planned_end_does_not_cut_tail(self):
        rows = [{"id": "a", "french": "Un.", "start_ms": 500, "end_ms": 1000},
                {"id": "b", "french": "Deux.", "start_ms": 2000, "end_ms": 2500}]
        group = Paragraph(["a", "b"], 0, 5000, "")
        result = readable_ends(rows, [group], [group], [[(150, 600), (790, 1000), (1650, 2200)]])
        self.assertEqual(result[0]["end_ms"], 1410)
        self.assertEqual(result[1]["start_ms"], 2000)

    def test_existing_output_or_source_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sentinel = root / "subtitles.ass"
            sentinel.write_text("Original à conserver.")
            for source in (root, root / "another-source"):
                with self.assertRaisesRegex(CLIError, "nouveau dossier"):
                    align_export(source, root, root, root)
            self.assertEqual(sentinel.read_text(), "Original à conserver.")

    def test_reading_hold_never_moves_onsets_or_leaves_a_tiny_blank(self):
        rows = [{"id": "a", "french": "Un.", "start_ms": 500, "end_ms": 1000},
                {"id": "b", "french": "Deux.", "start_ms": 1250, "end_ms": 2000},
                {"id": "c", "french": "Trois.", "start_ms": 2500, "end_ms": 3000}]
        group = Paragraph(["a", "b", "c"], 0, 5000, "")
        result = readable_ends(rows, [group], [group])
        self.assertEqual([r["start_ms"] for r in result], [500, 1250, 2500])
        self.assertEqual([r["end_ms"] for r in result], [1250, 2120, 3120])
        self.assertEqual(rows[0]["end_ms"], 1000)
        self.assertTrue(all(a["end_ms"] <= b["start_ms"] for a, b in zip(result, result[1:])))

    def test_acoustic_dictionary_preserves_display_spelling_and_refuses_unknown_numbers(self):
        labels = set("abcdefghijklmnopqrstuvwxyzéèàœç|")
        words = acoustic_words("L'été : Allah et la jāhiliyyah.", labels)
        self.assertEqual([w[0] for w in words], ["L'été", "Allah", "et", "la", "jāhiliyyah"])
        self.assertEqual("".join(words[0][1]), "lété")
        self.assertEqual("".join(words[-1][1]), "jahiliyyah")
        with self.assertRaises(CLIError):
            acoustic_words("Le nombre 42.", labels)

    def test_exact_text_word_times_and_take_offset_without_changing_text(self):
        rows = [{"id": "a", "french": "L'été commence.", "start_ms": 0, "end_ms": 1000},
                {"id": "b", "french": "Allah est cité.", "start_ms": 1000, "end_ms": 2000}]
        before = copy.deepcopy(rows)
        group = Paragraph(["a", "b"], 0, 5000, "")
        placement = Paragraph(["a", "b"], 10000, 15000, "")
        words = [{"word": w, "start": a, "end": b} for w, a, b in (
            ("L'été", .2, .5), ("commence.", .5, 1.1), ("Allah", 1.3, 1.7), ("est", 1.7, 1.9), ("cité.", 2, 2.5))]
        result = aligned_rows(rows, group, placement, words, 4)
        self.assertEqual((result[0]["start_ms"], result[0]["end_ms"]), (10550, 11450))
        self.assertEqual((result[1]["start_ms"], result[1]["end_ms"]), (11650, 12850))
        self.assertEqual(rows, before)
        self.assertEqual([r["french"] for r in result], [r["french"] for r in rows])
        with self.assertRaisesRegex(CLIError, "exactement"):
            aligned_rows(rows, group, placement, words[:-1], 4)

    def test_invalid_local_times_and_overlap_never_silently_publish(self):
        rows = [{"id": "a", "french": "Bonjour.", "start_ms": 0, "end_ms": 1000},
                {"id": "b", "french": "Merci.", "start_ms": 1000, "end_ms": 2000}]
        group = Paragraph(["a", "b"], 0, 5000, "")
        for words in ([{"word": "Bonjour.", "start": 1, "end": .5}],
                      [{"word": "Bonjour.", "start": 0, "end": 2}, {"word": "Merci.", "start": 1, "end": 3}],
                      [{"word": "Bonjour.", "start": 0, "end": 0}, {"word": "Merci.", "start": 1, "end": 2}]):
            with self.assertRaises(CLIError):
                aligned_rows(rows, group, group, words, 4)

    def test_independent_take_offsets_cannot_accumulate_drift(self):
        rows = [{"id": "a", "french": "Bonjour.", "start_ms": 0, "end_ms": 1000}]
        for i in range(250):
            group = Paragraph(["a"], i * 10000, i * 10000 + 5000, "")
            result = aligned_rows(rows, group, group, [{"word": "Bonjour.", "start": .1, "end": .6}], 4)
            self.assertEqual(result[0]["start_ms"], i * 10000 + 450)
            self.assertEqual(result[0]["end_ms"], i * 10000 + 950)
