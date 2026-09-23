import unittest
from sync_translation_prompt import SOURCE, TARGET, REPLACEMENTS, render

class DesktopTranslationParity(unittest.TestCase):
    def test_all_business_lines_are_preserved(self):
        source = SOURCE.read_text()
        server = render(source)
        body = source.split('Format de sortie attendu:\n')[0]
        for line in body.splitlines():
            if line and line not in REPLACEMENTS and line != '{{project_instructions_block}}':
                self.assertIn(line, server)
        self.assertEqual(server, TARGET.read_text())
        self.assertNotIn('{{', server)
        self.assertNotIn('document Markdown final', server)

    def test_changed_format_requires_explicit_review(self):
        source = SOURCE.read_text().replace('- Ne fusionne pas et ne divise pas les blocs.', '- Nouveau format inattendu.')
        with self.assertRaises(ValueError):
            render(source)

if __name__ == '__main__':
    unittest.main()
