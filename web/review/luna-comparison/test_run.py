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
    def test_continuity_keeps_bilingual_context_out_of_targets(self):
        source = [{'id': 'b', 'arabic': 'نعم'}]
        context = [{'id': 'a', 'arabic': 'السلام', 'french': 'Paix.'}]
        body = run.request_body('z-ai/glm-5.3-flash', 'Translate', source,
                                context_source=context, continuity=True, previous_summary='Un salut.')
        payload = json.loads(body['messages'][1]['content'])
        self.assertEqual(payload['segments'], [{'id': 'b', 'text': 'نعم'}])
        self.assertEqual(payload['context_only'], context)
        self.assertEqual(payload['previous_summary'], 'Un salut.')
        answer = {'segments': [{'id': 'b', 'text': 'Oui.'}], 'continuity_summary': 'Un salut et une réponse.'}
        run.validate_answer(answer, source, True)
        for invalid in [dict(answer, continuity_summary=''), dict(answer, continuity_summary='x'*1501),
                        dict(answer, segments=[{'id': 'a', 'text': 'Paix.'}]),
                        dict(answer, segments=answer['segments'] + [{'id': 'a', 'text': 'Paix.'}])]:
            with self.assertRaises(ValueError): run.validate_answer(invalid, source, True)
        self.assertNotIn('continuity_summary', run.SCHEMA['properties'])

    def test_timed_chunks_preserve_segments_and_exact_ten_minute_boundary(self):
        source = [{'start_ms': 0, 'end_ms': 599000},
                  {'start_ms': 599000, 'end_ms': 600000},
                  {'start_ms': 600000, 'end_ms': 601000}]
        self.assertEqual(run.timed_ranges(source, 10), [(0, 2), (2, 3)])
        corpus = json.loads((run.ROOT / 'web/review/translation-lite/corpus.json').read_text())
        ranges = run.timed_ranges(corpus, 10)
        self.assertEqual([s for a, b in ranges for s in corpus[a:b]], corpus)
        for a, b in ranges:
            self.assertLessEqual(corpus[b-1]['end_ms']-corpus[a]['start_ms'], 600000)

    def test_timed_chunks_reject_overlap_and_unsplittable_segment(self):
        for source in [[{'start_ms': 0, 'end_ms': 600001}],
                       [{'start_ms': 0, 'end_ms': 5}, {'start_ms': 4, 'end_ms': 7}]]:
            with self.assertRaises(ValueError): run.timed_ranges(source, 10)

    def test_responses_preserves_prompt_schema_and_parallel_tools(self):
        source = [{'id': 'a', 'arabic': 'السلام'}]
        chat = run.request_body(run.MODELS[0], 'Translate', source)
        response = run.request_body(run.MODELS[0], 'Translate', source, api='responses', reasoning='medium')
        self.assertEqual(response['instructions'], chat['messages'][0]['content'])
        self.assertEqual(response['input'][0]['content'][0]['text'], chat['messages'][1]['content'])
        self.assertEqual(response['tools'], chat['tools'])
        self.assertEqual(response['text']['format']['schema'], chat['response_format']['json_schema']['schema'])
        self.assertEqual(response['reasoning'], {'effort': 'medium'})
        self.assertNotIn('messages', response)

    def test_responses_preserves_preamble_and_rejects_incomplete_or_client_tool(self):
        message = lambda text: {'type': 'message', 'role': 'assistant', 'status': 'completed',
                                'content': [{'type': 'output_text', 'text': text}]}
        answer = '{"segments":[{"id":"a","text":"Paix."}]}'
        result = {'status': 'completed', 'output': [{'type': 'reasoning'}, message(answer)]}
        self.assertEqual(run.final_text(result, 'responses'), answer)
        result['output'].insert(1, message('Here is the translation: '))
        with self.assertRaises(json.JSONDecodeError): json.loads(run.final_text(result, 'responses'))
        for invalid in [{'status': 'incomplete', 'output': [message(answer)]},
                        {'status': 'completed', 'output': [{'type': 'function_call'}, message(answer)]}]:
            with self.assertRaises(ValueError): run.final_text(invalid, 'responses')

    def test_responses_reasoning_and_cost_are_recorded(self):
        result = {'model': run.MODELS[0], 'status': 'completed',
                  'usage': {'cost': 0.012, 'output_tokens_details': {'reasoning_tokens': 200}},
                  'output': [{'type': 'message', 'role': 'assistant', 'status': 'completed',
                    'content': [{'type': 'output_text', 'text': '{"segments":[{"id":"a","text":"Paix."}]}'}]}]}
        with tempfile.TemporaryDirectory() as tmp, patch('run.urllib.request.build_opener') as opener, contextlib.redirect_stdout(io.StringIO()):
            opener.return_value.open.return_value = Response(json.dumps(result).encode())
            summary = run.run_call(Path(tmp), run.MODELS[0], 'test', 'Translate',
                [{'id': 'a', 'arabic': 'السلام'}], 'test-credential', api='responses', reasoning='medium')
            self.assertTrue(summary['valid'])
            self.assertEqual(summary['reasoning_tokens'], 200)
            self.assertEqual(summary['usage']['cost'], 0.012)

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
