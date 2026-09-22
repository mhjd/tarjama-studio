import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

spec = importlib.util.spec_from_file_location('preview_render', Path(__file__).with_name('preview-render.py'))
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class PreviewSafetyTests(unittest.TestCase):
    def inputs(self):
        # Syntax fixtures only; these digests never reach the broker/registry.
        return dict(API_IMAGE='ghcr.io/mhjd/tarjama-web@sha256:' + 'a' * 64,
                    MEDIA_IMAGE='ghcr.io/mhjd/tarjama-media@sha256:' + 'b' * 64,
                    OIDC_ISSUER='https://identity.example.test', OIDC_CLIENT_ID='tarjama-test',
                    OIDC_EGRESS='oidc-test', WARP_HTTP_PROXY='192.0.2.10:3128',
                    WARP_EGRESS='warp-test', MEDIA_SECURITY='runtime-default')

    def test_no_implicit_activation_and_bootstrap_only_starts_database(self):
        self.assertEqual(preview.render(self.inputs()).count('enabled: false'), 5)
        prepared = preview.render(self.inputs(), 'bootstrap')
        self.assertEqual(prepared.count('enabled: true'), 1)
        self.assertIn('  db:\n    enabled: true', prepared)
        self.assertEqual(prepared.count('enabled: false'), 4)

    def test_rejects_unresolved_images_or_extra_secret_values(self):
        for field, value in [('API_IMAGE', 'tarjama-web:review'), ('MEDIA_IMAGE', 'REQUIRED_IMAGE'),
                             ('WARP_EGRESS', 'public-web'), ('OIDC_CLIENT_ID', 'client\nsecret: value')]:
            inputs = self.inputs()
            inputs[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                preview.render(inputs)
        inputs = self.inputs()
        inputs['GROQ_API_KEY'] = 'must-not-enter-recipe'
        with self.assertRaises(ValueError):
            preview.render(inputs)

    def test_refuses_overwriting_reviewed_recipe(self):
        import json
        with tempfile.TemporaryDirectory() as temp:
            source, output = Path(temp) / 'inputs.json', Path(temp) / 'recipe.yml'
            source.write_text(json.dumps(self.inputs()))
            output.write_text('previous reviewed recipe')
            with patch.object(sys, 'argv', ['render', '--inputs', str(source), '--output', str(output)]):
                with self.assertRaises(SystemExit) as caught:
                    preview.main()
            self.assertEqual(caught.exception.code, 1)
            self.assertEqual(output.read_text(), 'previous reviewed recipe')


if __name__ == '__main__':
    unittest.main()
