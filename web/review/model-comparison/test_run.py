import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('comparison', Path(__file__).with_name('run.py'))
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)

class ResponseValidation(unittest.TestCase):
    def test_accepts_exact_contract(self):
        comparison.validate({'segments': [{'id': 'a', 'text': 'Bonjour.'}]}, [{'id': 'a'}])

    def test_rejects_structurally_unusable_outputs(self):
        good = {'segments': [{'id': 'a', 'text': 'Bonjour.'}, {'id': 'b', 'text': 'Salut.'}]}
        invalid = [[], {'segments': []}, {'segments': list(reversed(good['segments']))}]
        for text in ['', ' ', '\ue000', '\0', '<!--test-->', 'x' * 16001, 3]:
            candidate = copy.deepcopy(good)
            candidate['segments'][0]['text'] = text
            invalid.append(candidate)
        candidate = copy.deepcopy(good)
        candidate['segments'][0]['timestamp'] = 12
        invalid.append(candidate)
        for value in invalid:
            with self.subTest(value=str(value)[:70]), self.assertRaises(ValueError):
                comparison.validate(value, [{'id': 'a'}, {'id': 'b'}])

    def test_evidence_is_not_overwritten(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'result.json'
            comparison.save(path, {'original': True})
            with self.assertRaises(FileExistsError):
                comparison.save(path, {'original': False})

if __name__ == '__main__':
    unittest.main()
