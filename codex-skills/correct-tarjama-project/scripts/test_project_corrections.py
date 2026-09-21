#!/usr/bin/env python3

import json
import tempfile
import unittest
from pathlib import Path

import project_corrections as corrections


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class ProjectCorrectionsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "projects"
        self.project_dir = self.root / "youtube_demo"
        transcript = {
            "corpus_id": "youtube_demo",
            "segments": [
                {"id": "0", "start": 0, "end": 2.5, "text": "النص القديم", "translation": ""},
                {"id": "1", "start": 2.5, "end": 5, "text": "نص ثان", "translation": ""},
            ],
            "created_at": "2026-01-01T00:00:00.000Z",
            "updated_at": "2026-01-01T00:00:00.000Z",
        }
        translation = {
            "corpus_id": "youtube_demo",
            "language": "fr",
            "source_transcript_fingerprint": "unchanged-alignment",
            "segments": [
                {"id": "0", "start": 0, "end": 2.5, "translation": "Ancien texte."},
                {"id": "1", "start": 2.5, "end": 5, "translation": "Deuxième texte."},
            ],
        }
        write_json(
            self.project_dir / "project.json",
            {
                "id": "youtube_demo",
                "title": "Démonstration arabe",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-02T00:00:00.000Z",
                "transcriptReviewedAt": "old",
                "transcriptReviewedFingerprint": "old-transcript",
                "translationReviewedAt": "old",
                "translationReviewedFingerprint": "old-translation",
            },
        )
        write_json(self.project_dir / "current.json", transcript)
        write_json(self.project_dir / "transcript.json", transcript)
        write_json(self.project_dir / "translation.json", translation)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_search_finds_arabic_in_recent_project(self) -> None:
        records = corrections.project_records(self.root)
        self.assertEqual(records[0]["id"], "youtube_demo")
        state = corrections.load_state(self.project_dir)
        self.assertEqual(corrections.segment_rows(state)[0]["text"], "النص القديم")

    def test_preview_rejects_stale_expected_text(self) -> None:
        plan = {
            "project_id": "youtube_demo",
            "changes": [
                {"segment_id": "0", "field": "text", "expected": "خطأ", "replacement": "الصحيح"}
            ],
        }
        with self.assertRaises(corrections.CorrectionError):
            corrections.evaluate_plan(self.root, plan, mutate=False)

    def test_apply_keeps_files_aligned_and_creates_backups(self) -> None:
        plan = {
            "project_id": "youtube_demo",
            "changes": [
                {
                    "segment_id": "0",
                    "field": "text",
                    "expected": "النص القديم",
                    "replacement": "النص الصحيح",
                },
                {
                    "segment_id": "0",
                    "field": "translation",
                    "expected": "Ancien texte.",
                    "replacement": "Texte corrigé.",
                },
            ],
        }
        result = corrections.apply_plan(self.root, plan, app_closed=True)
        current = corrections.read_json(self.project_dir / "current.json")
        saved = corrections.read_json(self.project_dir / "transcript.json")
        translation = corrections.read_json(self.project_dir / "translation.json")
        project = corrections.read_json(self.project_dir / "project.json")
        self.assertEqual(current, saved)
        self.assertEqual(current["segments"][0]["text"], "النص الصحيح")
        self.assertEqual(translation["segments"][0]["translation"], "Texte corrigé.")
        self.assertNotIn("transcriptReviewedFingerprint", project)
        self.assertNotIn("translationReviewedFingerprint", project)
        self.assertTrue(Path(result["backup"]).is_dir())
        self.assertEqual(len(result["snapshots"]), 4)

    def test_translation_only_preserves_transcript_confirmation(self) -> None:
        plan = {
            "project_id": "youtube_demo",
            "changes": [
                {
                    "segment_id": "1",
                    "field": "translation",
                    "expected": "Deuxième texte.",
                    "replacement": "Second texte.",
                }
            ],
        }
        corrections.apply_plan(self.root, plan, app_closed=True)
        project = corrections.read_json(self.project_dir / "project.json")
        self.assertEqual(project["transcriptReviewedFingerprint"], "old-transcript")
        self.assertNotIn("translationReviewedFingerprint", project)


if __name__ == "__main__":
    unittest.main()
