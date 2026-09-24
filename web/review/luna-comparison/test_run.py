import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import run


class Response(io.BytesIO):
    status = 200


class ComparisonEvidenceTests(unittest.TestCase):
    def call(self, root, content):
        result = {'id': 'fixture', 'model': run.MODELS[0], 'usage': {'cost': 0.01},
                  'choices': [{'finish_reason': 'stop', 'message': {'content': content}}]}
        with patch('run.urllib.request.build_opener') as opener, contextlib.redirect_stdout(io.StringIO()):
            opener.return_value.open.return_value = Response(json.dumps(result).encode())
            return run.run_call(root, run.MODELS[0], 'test', 'Translate',
                                [{'id': 'a', 'arabic': 'السلام'}], 'test-credential')

    def test_valid_result_saved_unchanged_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            answer = {'segments': [{'id': 'a', 'text': 'Paix.'}]}
            summary = self.call(root, json.dumps(answer))
            self.assertTrue(summary['valid'])
            self.assertEqual(json.loads(next(root.glob('*/translation.json')).read_text()), answer)
            with self.assertRaises(FileExistsError): self.call(root, json.dumps(answer))
            self.assertNotIn('test-credential', ''.join(p.read_text() for p in root.rglob('*.json')))

    def test_missing_ids_and_markdown_remain_failures_with_cost_and_raw_output(self):
        for content in ['{"segments":[]}', '```json\n{"segments":[{"id":"a","text":"Paix."}]}\n```']:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                summary = self.call(root, content)
                self.assertFalse(summary['valid'])
                self.assertEqual(summary['usage']['cost'], 0.01)
                self.assertEqual(len(list(root.glob('*/response.json'))), 1)
                self.assertEqual(len(list(root.glob('*/translation.json'))), 0)

    def test_http_error_body_and_credential_never_enter_evidence(self):
        with tempfile.TemporaryDirectory() as tmp, patch('run.urllib.request.build_opener') as opener, contextlib.redirect_stdout(io.StringIO()):
            opener.return_value.open.side_effect = urllib.error.HTTPError(run.ENDPOINT, 401,
                'sensitive-body-and-test-credential', {}, io.BytesIO(b'test-credential'))
            root = Path(tmp)
            summary = run.run_call(root, run.MODELS[0], 'error', 'Translate', [], 'test-credential')
            self.assertEqual(summary['http_status'], 401)
            self.assertFalse(summary['valid'])
            evidence = ''.join(p.read_text() for p in root.rglob('*.json'))
            self.assertNotIn('test-credential', evidence)
            self.assertNotIn('sensitive-body', evidence)


if __name__ == '__main__':
    unittest.main()
