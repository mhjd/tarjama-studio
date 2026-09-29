import unittest
from candidate import original, partition, words
from candidate_a import partition as first_candidate


class Width:
    def width(self, text):
        return len(text) * 20


def run(items, method=partition):
    source = [dict(start_ms=a, end_ms=b, french=t) for a, b, t in items]
    layout, fallback = original.layout_functions(Width())
    result = method(source, layout, fallback)
    assert ' '.join(c['text'] for c in result) == ' '.join(original.text_of(s) for s in source)
    return result


class Mechanisms(unittest.TestCase):
    def test_punctuated_enumeration_not_isolated(self):
        items = [(0, 1200, 'Or.'), (1200, 2400, 'Argent.'), (2400, 4000, 'Cuivre.')]
        self.assertEqual(len(run(items, original.partition)), 3)
        self.assertEqual(len(run(items)), 1)

    def test_question_not_attached_to_next_incomplete_clause(self):
        items = [(0, 2400, 'Comment expliquer ce résultat ?'),
                 (2400, 4400, 'Pour le comprendre'),
                 (4400, 11400, 'il faut examiner plusieurs phénomènes différents, tous présents dans cette expérience.')]
        self.assertEqual(run(items, original.partition)[0]['last'], 0)
        self.assertEqual(run(items)[0]['last'], 0)

    def test_brief_acknowledgment_can_join(self):
        items = [(0, 2000, 'Cinq degrés.'), (2000, 2500, 'Oui.')]
        self.assertEqual(len(run(items, original.partition)), 2)
        self.assertEqual(len(run(items)), 1)

    def test_pause_does_not_force_fragment(self):
        self.assertEqual(len(run([(0, 1200, 'Dans cette'), (2000, 3000, 'expérience,'),
                                  (3000, 5500, 'la température augmente.')])), 1)

    def test_complete_multiword_sentences_remain_separate(self):
        self.assertEqual(len(run([(0, 2500, 'La mesure est stable.'),
                                  (2500, 5000, 'La pression augmente.')])), 2)

    def test_long_pause_cannot_be_erased(self):
        self.assertEqual(len(run([(0, 1000, 'Certes.'), (10000, 12000, 'Continuons.')])), 2)

    def test_long_input_is_not_truncated(self):
        result = run([(0, 9000, 'Le texte source reste présent. ' * 8)])
        self.assertTrue(result[0]['exceptions'])

    def test_punctuation_not_counted_as_word(self):
        self.assertEqual(words('« Oui. »'), 1)

    def test_fast_sentence_does_not_absorb_next_sentence_prefix(self):
        items = [(0, 1000, 'Comment expliquer ce résultat ?'),
                 (1000, 4000, 'Pour le comprendre')]
        self.assertEqual(len(run(items, first_candidate)), 1)
        result = run(items)
        self.assertEqual(len(result), 2)
        self.assertIn('input_faster_than_21_cps', result[0]['exceptions'])


if __name__ == '__main__':
    unittest.main()
