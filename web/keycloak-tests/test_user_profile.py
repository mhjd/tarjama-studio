import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('profile_patch', Path(__file__).parents[1]/'scripts/keycloak-user-profile.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ProfilePatch(unittest.TestCase):
    def test_only_name_requirements_and_permissions_change(self):
        attributes = [{'name':name, 'required':{'roles':['user']},
                       'permissions':{'view':['admin','user'],'edit':['admin','user']},
                       'validations':{'length':{'max':255}}}
                      for name in ['username','email','firstName','lastName','custom']]
        profile = {'attributes':attributes,'groups':[{'name':'metadata'}],
                   'unmanagedAttributePolicy':'DISABLED','futureOption':{'keep':True}}
        before = copy.deepcopy(profile)
        after = module.without_personal_names(profile)
        self.assertEqual(profile, before)
        self.assertEqual(module.without_personal_names(after), after)
        for original, changed in zip(profile['attributes'],after['attributes']):
            if original['name'] in ('firstName','lastName'):
                self.assertNotIn('required',changed)
                self.assertEqual(changed['permissions'],{'view':['admin'],'edit':['admin']})
                changed['required'] = original['required']
                changed['permissions'] = original['permissions']
        self.assertEqual(after, profile)

    def test_refuse_incomplete_or_ambiguous_profile(self):
        for names in [[],['firstName'],['firstName','firstName','lastName']]:
            with self.assertRaises(ValueError):
                module.without_personal_names({'attributes':[{'name':n} for n in names]})
