"""Offline contract tests. No build, import, deployment or secret access."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'web/deploy/preview/active-long-transcript-20260927.yml'
SCRIPT = ROOT / 'web/scripts/keycloak-recipe.py'

class RecipeTest(unittest.TestCase):
    def render(self, **changes):
        flags = {'app-origin':'https://tarjama.runagen.com',
                 'identity-base-url':'https://tarjama.runagen.com/identity',
                 'admin-base-url':'https://localhost:9443/identity'}
        flags.update(changes)
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)/'candidate.yml'
            command = ['python3', str(SCRIPT), '--base', str(BASE), '--draft', '--output', str(dest)]
            for flag, value in flags.items(): command += ['--'+flag, value]
            result = subprocess.run(command, text=True, capture_output=True)
            return result.returncode, yaml.safe_load(dest.read_text()) if dest.exists() else None

    def test_single_origin_no_mail_stopped_and_preserved_resources(self):
        code, r = self.render()
        self.assertEqual(code, 0)
        base = yaml.safe_load(BASE.read_text())
        self.assertTrue(all(s['enabled'] is False for s in r['services'].values()))
        self.assertEqual(r['services']['egress'], dict(base['services']['egress'], enabled=False))
        self.assertEqual(r['services']['db'], dict(base['services']['db'], enabled=False))
        for name, v in base['volumes'].items(): self.assertEqual(r['volumes'][name], v)
        web, kc = r['services']['web'], r['services']['keycloak']
        self.assertEqual(web['env']['OIDC_ISSUER'], 'https://tarjama.runagen.com/identity/realms/tarjama')
        self.assertEqual(kc['env']['KC_HTTP_RELATIVE_PATH'], '/identity')
        self.assertEqual(kc['health']['path'], '/identity/health/ready')
        self.assertEqual(kc['env']['TARJAMA_BACKCHANNEL_URL'], 'http://web:8080/auth/backchannel-logout')
        self.assertEqual(kc['egress'], [])
        self.assertNotIn('keycloak-mail', json.dumps(r))
        self.assertNotIn('SMTP', json.dumps(r))
        self.assertNotIn('keycloak-smtp', json.dumps(r))
        self.assertEqual(kc['image'], 'REQUIRED_KEYCLOAK_IMAGE')
        realm = json.loads(r['configs']['keycloak-realm']['tarjama-realm.json'])
        self.assertFalse(realm['verifyEmail'])
        self.assertFalse(realm['resetPasswordAllowed'])
        self.assertNotIn('smtpServer', realm)
        self.assertFalse(any(a['enabled'] or a['defaultAction'] for a in realm['requiredActions'] if a['alias'] in ['VERIFY_EMAIL','UPDATE_PROFILE','VERIFY_PROFILE']))
        self.assertFalse(realm['clients'][0]['directAccessGrantsEnabled'])
        self.assertEqual(realm['clients'][0]['attributes']['pkce.code.challenge.method'], 'S256')

    def test_ambiguous_urls_and_public_administration_are_refused(self):
        for key, value in [
            ('app-origin','http://tarjama.runagen.com'),
            ('app-origin','https://tarjama.runagen.com/app'),
            ('app-origin','https://u:p@tarjama.runagen.com'),
            ('app-origin','https://tarjama.runagen.com?'),
            ('app-origin','https://TARJAMA.runagen.com'),
            ('app-origin','https://tarjama.runagen.com:443'),
            ('identity-base-url','https://other.runagen.com/identity'),
            ('identity-base-url','https://tarjama.runagen.com/auth'),
            ('identity-base-url','https://tarjama.runagen.com/identity/'),
            ('identity-base-url','https://tarjama.runagen.com/%69dentity'),
            ('identity-base-url','https://tarjama.runagen.com/identity/../auth'),
            ('identity-base-url','https://tarjama.runagen.com/identity#evil'),
            ('admin-base-url','https://tarjama.runagen.com/identity'),
            ('admin-base-url','https://localhost:0/identity'),
            ('admin-base-url','https://localhost:65536/identity'),
            ('admin-base-url','https://localhost:9443/identity\n'),
        ]:
            with self.subTest(key=key, value=value):
                code, _ = self.render(**{key:value})
                self.assertNotEqual(code, 0)

    def test_historical_images_are_not_reused(self):
        with tempfile.TemporaryDirectory() as tmp:
            command = ['python3', str(SCRIPT), '--base', str(BASE),
                       '--images', str(ROOT/'web/deploy/keycloak/images-20260927.json'),
                       '--app-origin','https://tarjama.runagen.com',
                       '--identity-base-url','https://tarjama.runagen.com/identity',
                       '--admin-base-url','https://localhost:9443/identity',
                       '--output',str(Path(tmp)/'candidate.yml')]
            result = subprocess.run(command, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('historical images', result.stderr)
