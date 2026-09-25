import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

import gemini_lite


class GeminiLiteSupervisorTests(unittest.TestCase):
    def test_fixed_bounded_protocol(self):
        self.assertEqual(len(gemini_lite.MODELS), 2)
        for model in gemini_lite.MODELS:
            cmd = gemini_lite.command(model, Path('/tmp/example'))
            self.assertIn('--continuity', cmd)
            self.assertIn('--no-output-limit', cmd)
            self.assertEqual(cmd[cmd.index('--reasoning') + 1], 'high')
            self.assertEqual(cmd[cmd.index('--provider') + 1], 'google-ai-studio')
            self.assertEqual(cmd[cmd.index('--timeout-seconds') + 1], '300')
            self.assertEqual(cmd[cmd.index('--chunk-minutes') + 1], '4')

    def test_success_exit_alone_does_not_mean_valid_translation(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            self.assertEqual(gemini_lite.result_state(p, 0)['state'], 'incomplete')
            (p / 'results.json').write_text(json.dumps([{'valid': False, 'usage': {'cost': 0.1}}]))
            result = gemini_lite.result_state(p, 0)
            self.assertEqual(result['state'], 'incomplete')
            self.assertEqual(result['known_cost_usd'], 0.1)
            (p / 'results.json').write_text(json.dumps([{'valid': True}] * 4))
            result = gemini_lite.result_state(p, 0)
            self.assertEqual(result['state'], 'complete')
            self.assertTrue(result['cost_may_be_incomplete'])

    def test_stop_terminates_process_group(self):
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
                                 start_new_session=True)
        try:
            gemini_lite.stop(child)
            self.assertIsNotNone(child.poll())
            with self.assertRaises(ProcessLookupError):
                os.killpg(child.pid, 0)
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


if __name__ == '__main__':
    unittest.main()
