import unittest
from candidate import original, partition, clause_boundary
from sentences import ICU, SentenceMap


class Width:
    def width(self, text):
        return len(text)*20


def source(texts, milliseconds=1500):
    return [dict(start_ms=i*milliseconds, end_ms=(i+1)*milliseconds, french=t)
            for i,t in enumerate(texts)]


def group(data):
    layout, fallback = original.layout_functions(Width())
    result = partition(data, layout, fallback)
    assert ' '.join(g['text'] for g in result) == ' '.join(original.text_of(s) for s in data)
    return result


class SentenceGrouping(unittest.TestCase):
    def test_abbreviation_decimal_and_unicode_offsets(self):
        text = 'M. Dupont mesure 3.5 degrés. 🧪 Une autre mesure suit.'
        spans = ICU().spans(text)
        self.assertEqual([text[a:b].strip() for a,b in spans],
                         ['M. Dupont mesure 3.5 degrés.', '🧪 Une autre mesure suit.'])

    def test_whole_sentence_before_fragments(self):
        data = source(['La température', 'augmente dans', 'le récipient.'])
        self.assertEqual(len(group(data)), 1)

    def test_prefix_orphan_inside_other_sentence(self):
        data = source(['La mesure est finie. Une', 'nouvelle expérience commence.'])
        m = SentenceMap(data)
        self.assertEqual(m.orphans([dict(first=0,last=0),dict(first=1,last=1)])[0]['position'], 'prefix')
        self.assertFalse(m.orphans(group(data)))

    def test_suffix_orphan_inside_next_sentence(self):
        data = source(['Nous avançons avec beaucoup de', 'précaution. La suite arrive.'])
        m = SentenceMap(data)
        self.assertEqual(m.orphans([dict(first=0,last=0),dict(first=1,last=1)])[0]['position'], 'suffix')
        self.assertFalse(m.orphans(group(data)))

    def test_whole_single_word_answer_not_fragment(self):
        data = source(['Oui.', 'Le résultat est stable.'])
        self.assertFalse(SentenceMap(data).orphans([dict(first=0,last=0),dict(first=1,last=1)]))

    def test_comma_preferred_when_whole_sentence_exceeds_duration(self):
        data = source(['Après la mesure,', 'la température augmente', 'dans la pièce.'],2500)
        groups = group(data)
        self.assertEqual(groups[0]['last'],0)
        self.assertEqual(groups[1]['last'],2)

    def test_balance_when_no_punctuation(self):
        data = source(['Nous', 'observons une variation', 'de température notable', 'ce matin.'],2000)
        groups = group(data)
        self.assertEqual([(g['first'],g['last']) for g in groups],[(0,1),(2,3)])

    def test_cannot_invent_word_time_to_fix_orphan(self):
        data = [dict(start_ms=0,end_ms=6800,french='La première mesure est terminée. Une'),
                dict(start_ms=6800,end_ms=8500,french='nouvelle mesure commence.')]
        self.assertEqual(len(group(data)),2)

    def test_long_existing_text_preserved(self):
        data = source(['Tout ce texte doit rester présent. '*6],10000)
        self.assertTrue(group(data)[0]['exceptions'])


if __name__ == '__main__':
    unittest.main()
