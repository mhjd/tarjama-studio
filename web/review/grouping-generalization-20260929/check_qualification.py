"""Known failing qualification: not part of the passing mechanism suite.

Keep this counterexample until a future, separately frozen campaign addresses it.
This is a general laboratory explanation, not a quotation from the Sirat video.
"""
import unittest
from test_candidate import run
from candidate import original


class ConditionalCoherence(unittest.TestCase):
    def test_do_not_split_statement_from_its_condition_to_absorb_acknowledgment(self):
        items = [(0, 1700, 'Pour conclure,'),
                 (1700, 6400, 'ce procédé ne fonctionne pas'),
                 (6400, 8160, 'si le récipient reste ouvert.'),
                 (8160, 10260, 'Compris ?'),
                 (10260, 14060, 'Voyons maintenant une autre expérience,')]
        previous = run(items, original.partition)
        self.assertTrue(any(g['first'] <= 1 and g['last'] >= 2 for g in previous))
        candidate = run(items)
        self.assertTrue(any(g['first'] <= 1 and g['last'] >= 2 for g in candidate),
                        'Candidate B separates a statement from its condition to absorb an acknowledgment')


if __name__ == '__main__':
    unittest.main()
