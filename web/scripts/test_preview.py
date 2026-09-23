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
        return dict(API_IMAGE='preview.local/atelier/web@sha256:' + 'a' * 64,
                    OIDC_ISSUER='https://identity.example.test', OIDC_CLIENT_ID='tarjama-test',
                    OIDC_EGRESS='oidc-test', WARP_HTTP_PROXY='192.0.2.10:3128',
                    WARP_EGRESS='warp-test')

    def test_no_implicit_activation_and_bootstrap_only_starts_database(self):
        self.assertEqual(preview.render(self.inputs()).count('enabled: false'), 4)
        prepared = preview.render(self.inputs(), 'bootstrap')
        self.assertEqual(prepared.count('enabled: true'), 1)
        self.assertIn('  db:\n    enabled: true', prepared)
        self.assertEqual(prepared.count('enabled: false'), 3)

    def test_rejects_unresolved_images_or_extra_secret_values(self):
        for field, value in [('API_IMAGE', 'tarjama-web:review'), ('API_IMAGE', 'REQUIRED_IMAGE'),
                             ('API_IMAGE', 'preview.local/another-slot/web@sha256:' + 'a' * 64), ('WARP_EGRESS', 'public-web'), ('OIDC_CLIENT_ID', 'client\nsecret: value')]:
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

    def test_render_updates_already_pinned_images(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'web/deploy/preview').mkdir(parents=True)
            (root / 'web/deploy/preview/bootstrap-db.sh').write_text('# synthetic bootstrap\n')
            (root / 'deploy.preview.yml').write_text(
                'services:\n  web:\n    enabled: false\n    image: preview.local/atelier/web@sha256:' + 'c' * 64 +
                '\n')
            with patch.object(preview, 'ROOT', root):
                result = preview.render(self.inputs())
            self.assertIn(self.inputs()['API_IMAGE'], result)
            self.assertNotIn('c' * 64, result)


if __name__ == '__main__':
    unittest.main()
