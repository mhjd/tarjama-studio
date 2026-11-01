import argparse
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import api_workflow
from workspace import CLIError, read_json, write_json


class APIWorkflowTests(unittest.TestCase):
    def test_failed_chunk_resumes_without_repaying_completed_chunk(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            source = {"id":"api_test", "title":"Test", "version":1, "arabic_version":1,
                      "duration_ms":3000, "segments":[{"id":str(i), "start_ms":i*1000,
                      "end_ms":(i+1)*1000, "arabic":"نص", "french":"", "version":1} for i in range(2)]}
            write_json(directory / "project.json", source)
            args = argparse.Namespace(project=directory, corpus=directory, kind="translation", video=None)
            calls, fail = [], [True]

            def bridge(request, audit):
                if request["kind"] == "plan":
                    return {"chunks":[[s] for s in source["segments"]], "model":"fixture"}
                if request["kind"] == "validate-text":
                    return None
                index = request["chunk"]
                calls.append(index)
                if index == 1 and fail[0]:
                    raise CLIError("Temporary failure")
                return {"segments":[{"id":str(index), "text":"Bonjour."}]}

            with patch.object(api_workflow,"engine_fingerprint",return_value="fixture"), \
                 patch.object(api_workflow,"file_hash",return_value="binary"), \
                 patch.object(api_workflow,"bridge",side_effect=bridge):
                with self.assertRaises(CLIError):
                    api_workflow.api_command(args)
                self.assertEqual(read_json(directory / "project.json"), source)
                fail[0] = False
                api_workflow.api_command(args)
            self.assertEqual(calls,[0,1,1])
            updated = read_json(directory / "project.json")
            self.assertEqual(updated["stage"],"review")
            self.assertTrue(all(s["french"] == "Bonjour." for s in updated["segments"]))
            self.assertEqual([(s["start_ms"],s["end_ms"]) for s in updated["segments"]],[(0,1000),(1000,2000)])
