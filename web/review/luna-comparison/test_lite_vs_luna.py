import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import lite_vs_luna as trial


class InlinePool:
    def __init__(self, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def submit(self, fn, *args, **kwargs):
        value = fn(*args, **kwargs)
        class Result:
            def result(self): return value
        return Result()


class ReplayTests(unittest.TestCase):
    def replay(self, failure=None):
        calls = []
        def fake_call(out, model, case, prompt, source, key, **kw):
            self.assertEqual(key, 'fake-test-key')
            self.assertLessEqual(len(kw['context_source']), 5)
            if kw['context_source']:
                self.assertTrue(kw['previous_summary'])
                self.assertTrue(all(s['french'] == 'Traduction.' for s in kw['context_source']))
            calls.append((model, case))
            folder = out / (case + '-' + model.split('/')[1]); folder.mkdir()
            failed = failure and model == trial.ARMS[0][1]
            result = {'valid': not failed, 'usage': {'cost': 0.01}, 'http_status': 200}
            if failed:
                result['error'] = failure
            else:
                trial.run.save(folder / 'translation.json', {
                    'segments': [{'id': s['id'], 'text': 'Traduction.'} for s in source],
                    'continuity_summary': 'Résumé.'})
            return result
        def public_catalog(url, **kwargs):
            if url.endswith('/models'):
                value = {'data': [{'id': a[1], 'reasoning': {'supported_efforts': [a[3]]}} for a in trial.ARMS]}
            else:
                arm = next(a for a in trial.ARMS if a[1] + '/endpoints' in url)
                value = {'data': {'endpoints': [{'tag': arm[4], 'provider_name': arm[5]}]}}
            return io.StringIO(json.dumps(value))
        original_read = Path.read_text
        def read(path, *args, **kwargs):
            if str(path) == '/etc/vps-agent-secrets/openrouter.api_key': return 'fake-test-key'
            return original_read(path, *args, **kwargs)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'trial'
            with patch('sys.argv', ['trial', '--output', str(out)]), \
                 patch.object(Path, 'read_text', read), \
                 patch.object(trial.urllib.request, 'urlopen', side_effect=public_catalog), \
                 patch.object(trial, 'ProcessPoolExecutor', InlinePool), \
                 patch.object(trial.run, 'run_call', side_effect=fake_call):
                trial.main()
            states = json.loads((out / 'states.json').read_text())
        return calls, states

    def test_complete_and_alternating_order(self):
        calls, states = self.replay()
        self.assertEqual(len(calls), 8)
        self.assertEqual([x[0] for x in calls[:4]], [trial.ARMS[i][1] for i in [0, 1, 1, 0]])
        self.assertTrue(all(s['valid_blocks'] == 4 for s in states.values()))

    def test_two_invalid_attempts_stop_only_failed_chain(self):
        calls, states = self.replay('JSONDecodeError')
        self.assertEqual(len(calls), 6)
        self.assertEqual(states['luna-medium']['valid_blocks'], 0)
        self.assertEqual(states['gemini31-high']['valid_blocks'], 4)

    def test_timeout_never_retried(self):
        calls, states = self.replay('TimeoutError')
        self.assertEqual(len(calls), 5)
        self.assertEqual(states['luna-medium']['stopped'], 'non_retryable_failure')
