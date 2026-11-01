from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from retry_asr_chunk import retry
from workspace import CLIError, read_json, source_digest, write_json


class RetryASRTests(unittest.TestCase):
    def test_recovery_preserves_raw_chunks_and_validates_before_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = {"id": "test", "segments": [], "duration_ms": 1200000}
            write_json(root / "project.json", project)
            audit = root / "api_runs" / "run"
            write_json(audit / "identity.json", {"kind": "transcribe", "source": source_digest(project),
                       "engine": "engine", "binary": "hash", "video": "hash"})
            calls = []
            def bridge(request, folder):
                calls.append(request)
                if request["kind"] == "audio":
                    return {"start": request["start"], "duration": request["duration"],
                            "response": {"segments": [{"start": 0, "end": 1, "text": "fixture"}]}, "raw": {"kept": True}}
                chunks = request["asr_chunks"]
                return [{"start_ms": round(c["start"] * 1000), "end_ms": round(c["start"] * 1000) + 1000,
                         "arabic": "fixture"} for c in chunks]
            with patch("retry_asr_chunk.engine_fingerprint", return_value="engine"), \
                    patch("retry_asr_chunk.file_hash", return_value="hash"), \
                    patch("retry_asr_chunk.probe", return_value={"duration_ms": 1200000}), \
                    patch("retry_asr_chunk.run"), patch("retry_asr_chunk.bridge", side_effect=bridge):
                retry(root, audit, 1, 180, root)
                saved = read_json(audit / "0001.json")
                self.assertEqual(saved["start"], 580)
                self.assertEqual(saved["duration"], 600)
                self.assertEqual([s["start"] for s in saved["response"]["segments"]], [0, 180, 360, 540])
                self.assertEqual(len(saved["raw"]["chunks"]), 4)
                self.assertTrue(all(c["raw"]["kept"] for c in saved["raw"]["chunks"]))
                self.assertEqual(calls[-1]["kind"], "merge-asr")
                with self.assertRaises(CLIError):
                    retry(root, audit, 1, 180, root)
