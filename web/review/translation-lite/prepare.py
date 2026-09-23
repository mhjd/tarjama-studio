"""Prepare standalone benchmark jobs on top of an explicitly supplied active recipe."""
import argparse
import copy
import json
from pathlib import Path
import yaml

p = argparse.ArgumentParser()
p.add_argument('--base', required=True)
p.add_argument('--image', required=True)
p.add_argument('--run', required=True)
p.add_argument('--output', required=True)
a = p.parse_args()
if not a.run.replace('-', '').isalnum():
    raise SystemExit('Invalid run identifier')
r = yaml.safe_load(Path(a.base).read_text())
r['jobs'] = {}
for name in ('corpus', 'challenges'):
    output = '/storage/data/model_outputs/' + a.run + '/' + name
    base = dict(image=a.image, uid=10001, gid=10001,
                volumes=[dict(name='library', path='/storage')],
                resources=dict(cpu='250m', memory='256Mi'), tmp='32Mi')
    r['jobs']['text-' + name] = dict(copy.deepcopy(base),
        args=['--input', '/benchmark-inputs/' + name + '.json', '--output', output],
        env={'GEMINI_API_KEY_FILE': '/run/gemini/api_key'},
        secrets=[dict(name='tarjama-gemini', path='/run/gemini')],
        egress=['public-web'], timeout=420)
    r['jobs']['read-' + name] = dict(copy.deepcopy(base),
        args=['--read-next', '--output', output], timeout=30)
text = yaml.safe_dump(r, allow_unicode=True, sort_keys=False)
if max(len(text.encode()), len(json.dumps(r).encode())) > 65536:
    raise SystemExit('Recipe exceeds broker size limit')
Path(a.output).write_text(text)
print('Prepared', len(text.encode()), 'bytes; no deployment performed')
