import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('ghcr', Path(__file__).with_name('ghcr-private.py'))
ghcr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ghcr)


class PrivatePublicationTests(unittest.TestCase):
    def test_public_or_inaccessible_package_blocks_application_publication(self):
        for state in ['public', 'internal', None]:
            with patch.object(ghcr, 'visibility', return_value=state), patch.object(ghcr.subprocess, 'run') as run:
                with self.assertRaises(RuntimeError):
                    ghcr.ensure_private('tarjama-web', 'fixture', 'a' * 40)
                run.assert_not_called()

    def test_bootstrap_contains_no_application_content_and_requires_private_result(self):
        with patch.object(ghcr, 'visibility', side_effect=[None, 'public']), patch.object(ghcr.subprocess, 'run') as run:
            with self.assertRaises(RuntimeError):
                ghcr.ensure_private('tarjama-web', 'fixture', 'a' * 40, bootstrap=True)
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[0].kwargs['input'],
                             b'FROM scratch\nLABEL org.opencontainers.image.source="https://github.com/mhjd/tarjama-studio"\n')
            self.assertEqual(run.call_args_list[1].args[0][:2], ['docker', 'push'])

    def test_existing_private_package_requires_no_bootstrap(self):
        with patch.object(ghcr, 'visibility', return_value='private'), patch.object(ghcr.subprocess, 'run') as run:
            ghcr.ensure_private('tarjama-web', 'fixture', 'a' * 40, bootstrap=True)
            run.assert_not_called()
