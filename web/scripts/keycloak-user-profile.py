#!/usr/bin/env python3
"""Prepare an offline patch of an exported Keycloak user profile; never calls an API."""
import copy
import json
import sys


def without_personal_names(profile):
    result = copy.deepcopy(profile)
    attributes = result.get('attributes', [])
    for name in ('firstName', 'lastName'):
        matches = [attribute for attribute in attributes if attribute.get('name') == name]
        if len(matches) != 1:
            raise ValueError(f'Expected exactly one {name} attribute; review profile before applying')
        attribute = matches[0]
        attribute.pop('required', None)
        # Native Keycloak forms omit fields the end-user cannot view/edit.
        # Keep admin access and stored values; this is not a user-data migration.
        attribute['permissions'] = {'view': ['admin'], 'edit': ['admin']}
    return result


if __name__ == '__main__':
    try:
        json.dump(without_personal_names(json.load(sys.stdin)), sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write('\n')
    except (ValueError, TypeError, AttributeError) as error:
        print(f'Profile preparation refused: {error}', file=sys.stderr)
        sys.exit(1)
