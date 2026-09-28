"""Guard the theme's deliberately small authentication boundary."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
THEMES = ROOT / 'deploy/keycloak/themes'

class ThemeContract(unittest.TestCase):
    def test_login_only_and_native_forms(self):
        self.assertEqual(sorted(p.name for p in (THEMES/'tarjama-v1').iterdir()), ['login'])
        # No fork of login/register/OTP templates and no credential-handling JS.
        self.assertEqual(sorted(p.name for p in THEMES.rglob('*.ftl')), ['footer.ftl'])
        self.assertEqual(list(THEMES.rglob('*.js')), [])
        props = (THEMES/'tarjama-v1/login/theme.properties').read_text()
        self.assertIn('parent=keycloak.v2', props)
        self.assertIn('styles=css/styles.css css/tarjama.css', props)

    def test_no_remote_theme_resources(self):
        css = (THEMES/'tarjama-v1/login/resources/css/tarjama.css').read_text()
        self.assertNotIn('@import', css)
        self.assertNotIn('https:', css)
        self.assertNotIn('http:', css)
        self.assertNotIn('url(', css)

    def test_packaged_without_live_realm_activation(self):
        dockerfile = (ROOT/'deploy/keycloak/Dockerfile').read_text()
        self.assertIn('themes/ /opt/keycloak/themes/', dockerfile)
        self.assertNotIn('loginTheme', (ROOT/'deploy/keycloak/tarjama-realm.json').read_text())
        self.assertNotIn('loginTheme', (ROOT/'deploy/keycloak/entrypoint.sh').read_text())

if __name__ == '__main__':
    unittest.main()
