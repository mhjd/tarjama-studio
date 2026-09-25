import unittest
import review

class ReviewValidation(unittest.TestCase):
    def test_reference_and_replacement_integrity(self):
        rows = [{'id': 'a', 'french': 'Avant.'}]
        issue = {'id': 'a', 'before': 'Avant.', 'after': 'Après.', 'explanation': 'Sens.', 'confidence': 'certain'}
        review.validate_review({'issues': [issue]}, rows)
        review.validate_review({'issues': []}, rows)
        for bad in [dict(issue, id='other'), dict(issue, before='inventé'), dict(issue, after=''),
                    dict(issue, after='Avant.'), dict(issue, confidence='maybe')]:
            with self.assertRaises(ValueError): review.validate_review({'issues': [bad]}, rows)
        with self.assertRaises(ValueError): review.validate_review({'issues': [issue, issue]}, rows)
