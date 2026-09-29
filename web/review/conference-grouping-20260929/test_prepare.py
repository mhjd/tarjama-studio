import unittest
from prepare import layout_functions, partition


class FixedMeasure:
    def width(self, text):
        return len(text)*20


def segments(items):
    return [dict(start_ms=a, end_ms=b, french=t) for a,b,t in items]


class GroupingTests(unittest.TestCase):
    def group(self, items):
        source = segments(items)
        layout, fallback = layout_functions(FixedMeasure())
        result = partition(source, layout, fallback)
        self.assertEqual(' '.join(x['text'] for x in result), ' '.join(x['french'] for x in source))
        return result

    def test_three_parts_across_internal_pause(self):
        result = self.group([(0,1000,'Un'),(1900,2500,'jour,'),(2500,5000,'son père fut occupé.')])
        self.assertEqual(len(result), 1)
        self.assertEqual((result[0]['start_ms'],result[0]['end_ms']), (0,5000))

    def test_ten_words_no_longer_excluded(self):
        result = self.group([(0,3500,'il le choyait et le gardait à la maison. Un'),(3500,4000,'jour,'),(4000,6000,'son père fut occupé')])
        self.assertEqual(len(result), 1)

    def test_whole_candidate_can_recover_speed(self):
        result = self.group([(0,300,'Une phrase'),(300,400,'très'),(400,4000,'importante.')])
        self.assertEqual(len(result), 1)

    def test_actual_un_jour_cannot_fit_seven_seconds(self):
        result = self.group([(2770100,2776820,'il le choyait et le gardait à la maison. Un'),(2776820,2777200,'jour,'),(2777200,2779040,'son père fut occupé'),(2779040,2781100,'par une affaire,')])
        self.assertEqual(len(result), 2)
        self.assertEqual(result[1]['text'], 'jour, son père fut occupé par une affaire,')
        self.assertEqual(result[0]['last'], 0)

    def test_complete_short_sentences_stay_separate(self):
        result = self.group([(0,3000,'Merci.'),(3000,6000,'Bienvenue.')])
        self.assertEqual(len(result), 2)

    def test_input_exception_not_truncated(self):
        text = 'Ce long passage doit rester intégralement conservé. ' * 4
        result = self.group([(0,9000,text.strip())])
        self.assertTrue(result[0]['exceptions'])
        self.assertEqual(result[0]['text'], text.strip())

    def test_no_one_word_line_when_balanced_break_exists(self):
        layout, _ = layout_functions(FixedMeasure())
        lines = layout('il le choyait et le gardait à la maison. Un')
        self.assertEqual(len(lines), 2)
        self.assertGreater(min(len(x.split()) for x in lines), 1)


if __name__ == '__main__':
    unittest.main()
