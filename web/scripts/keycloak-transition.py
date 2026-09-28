#!/usr/bin/env python3
"""Render reviewable phases only. Never deploy, migrate, call an API or read secrets."""
import argparse
import copy
import json
from pathlib import Path
import yaml

p = argparse.ArgumentParser()
p.add_argument('--active', required=True)
p.add_argument('--candidate', required=True)
p.add_argument('--output-dir', required=True)
a = p.parse_args()
active = yaml.safe_load(Path(a.active).read_text())
candidate = yaml.safe_load(Path(a.candidate).read_text())
legacy = {'web', 'worker', 'db', 'egress'}
if set(active['services']) != legacy or any(not active['services'][s].get('enabled', True) for s in legacy):
    p.error('expected the reviewed four-service active baseline')
if set(candidate['services']) != legacy | {'authdb', 'keycloak'} or any(s.get('enabled', True) for s in candidate['services'].values()):
    p.error('expected the reviewed six-service stopped candidate')
for name in ['db', 'egress']:
    if dict(active['services'][name], enabled=False) != candidate['services'][name]:
        p.error('candidate changes existing '+name)
if any(candidate['volumes'].get(k) != v for k, v in active['volumes'].items()):
    p.error('existing storage must remain unchanged')
if any('REQUIRED_' in str(s['image']) or '@sha256:' not in s['image'] for s in candidate['services'].values()):
    p.error('qualified image digests required')
if candidate['services']['keycloak']['env']['KC_HOSTNAME_ADMIN'] != 'https://localhost:9443':
    p.error('private master contract must be reviewed for a different admin origin')

# Start with candidate-only identity/configuration, restore every live service
# exactly, and retain the old jobs until the identity database is bootstrapped.
first = copy.deepcopy(candidate)
first['services'].update(copy.deepcopy(active['services']))
first['jobs'] = copy.deepcopy(active['jobs'])
first['services']['authdb']['enabled'] = True
bootstrap = copy.deepcopy(first)
bootstrap['services']['keycloak']['enabled'] = True
ready = copy.deepcopy(bootstrap)
ready['services']['keycloak']['secrets'] = [s for s in ready['services']['keycloak']['secrets'] if s['name'] != 'tarjama-keycloak-bootstrap']
ready['jobs'] = copy.deepcopy(candidate['jobs'])
maintenance = copy.deepcopy(ready)
for name in ['web', 'worker']:
    maintenance['services'][name]['enabled'] = False
web = copy.deepcopy(candidate)
for service in web['services'].values():
    service['enabled'] = True
web['services']['worker']['enabled'] = False
web['services']['keycloak'] = copy.deepcopy(ready['services']['keycloak'])
worker = copy.deepcopy(web)
worker['services']['worker']['enabled'] = True

phases = {
    '01-authdb': first,
    '02-private-bootstrap': bootstrap,
    '03-private-identity-ready': ready,
    '04-maintenance': maintenance,
    '05-private-web': web,
    '06-private-worker': worker,
    # Only after reversing identity mappings; retains dedicated identity data.
    '07-return-authelia': ready,
}
out = Path(a.output_dir)
out.mkdir(parents=True, exist_ok=True)
for name, recipe in phases.items():
    dest = out/(name+'.yml')
    if dest.exists():
        p.error('refusing to overwrite existing phase '+str(dest))
for name, recipe in phases.items():
    (out/(name+'.yml')).write_text(
        '# PREPARED ONLY. Requires separate owner authorization and phase gates.\n'
        '# See docs/KEYCLOAK_TRANSITION_20260928.md. May recreate existing services.\n'
        + yaml.safe_dump(recipe, sort_keys=False, allow_unicode=True))
print(json.dumps({'directory': str(out), 'phases': list(phases), 'applied': False}))
