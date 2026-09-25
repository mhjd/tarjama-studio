import unittest
from sentence import sentence_groups, validate_alignment


class SentenceTests(unittest.TestCase):
    def test_grouping_and_non_rewriting_alignment(self):
        source = [{'id':'a','arabic':'قال،'}, {'id':'b','arabic':'لا.'}, {'id':'c','arabic':'لماذا؟'}]
        groups = sentence_groups(source)
        self.assertEqual([[s['id'] for s in g] for g in groups], [['a','b'],['c']])
        text = [{'text':'Il dit : non.'}, {'text':'Pourquoi ?'}]
        aligned = {'segments':[{'id':'a','text':'Il dit :'}, {'id':'b','text':'non.'}, {'id':'c','text':'Pourquoi ?'}]}
        validate_alignment(groups, text, aligned)
        aligned['segments'][1]['text'] = 'oui.'
        with self.assertRaises(ValueError): validate_alignment(groups, text, aligned)

    def test_missing_duplicate_and_empty_fragments_fail(self):
        groups = [[{'id':'a'}], [{'id':'b'}]]
        text = [{'text':'A'}, {'text':'B'}]
        for rows in [[{'id':'a','text':'A'}], [{'id':'a','text':'A'}, {'id':'a','text':'B'}],
                     [{'id':'a','text':'A'}, {'id':'b','text':''}]]:
            with self.assertRaises(ValueError):validate_alignment(groups,text,{'segments':rows})


if __name__ == '__main__': unittest.main()
