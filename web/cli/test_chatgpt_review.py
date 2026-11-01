import argparse
import contextlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import chatgpt_review
from main import status_command
from workspace import source_digest, write_json


class ReviewTests(unittest.TestCase):
    def test_shortcuts_use_existing_commands_without_exposing_content(self):
        for action, function in [("cleanup", "prompt_command"), ("translation", "prompt_command"),
                                 ("import-cleanup", "import_command"), ("import-translation", "import_command"),
                                 ("status", "status_command")]:
            with self.subTest(action=action), patch("sys.argv", ["review", action, "--project", "workspace"]), \
                    patch.object(chatgpt_review, function) as command:
                chatgpt_review.main()
                args = command.call_args.args[0]
                self.assertEqual(args.project, Path("workspace"))
                if action.startswith("import-"):
                    self.assertTrue(args.clipboard)
                elif action != "status":
                    self.assertFalse(args.no_copy)

    def test_status_shows_counts_and_stale_prompts_not_subtitle_text(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = {"id": "test", "stage": "arabic", "version": 2, "duration_ms": 1000,
                       "segments": [{"id": "a", "start_ms": 0, "end_ms": 1000,
                                     "arabic": "PRIVATE_ARABIC", "french": "PRIVATE_FRENCH"}]}
            write_json(root / "project.json", project)
            write_json(root / "pending-cleanup.json", {"source_sha256": source_digest(project)})
            write_json(root / "pending-translation.json", {"source_sha256": "outdated"})
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                status_command(argparse.Namespace(project=root))
            text = output.getvalue()
            self.assertIn("traduits : 1/1", text)
            self.assertIn("prêt à importer", text)
            self.assertIn("périmé", text)
            self.assertNotIn("PRIVATE", text)
