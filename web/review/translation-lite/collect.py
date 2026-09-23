"""Retrieve benchmark translation JSON via bounded, authorized reader jobs."""
import argparse
import json
from pathlib import Path
import subprocess
import time

p = argparse.ArgumentParser()
p.add_argument('--case', choices=['corpus', 'challenges'], required=True)
p.add_argument('--output', required=True)
p.add_argument('--resume', action='store_true')
a = p.parse_args()
out = Path(a.output)
if out.exists() and not a.resume:
    raise SystemExit('Refusing to overwrite evidence; --resume only continues saved pages')
out.mkdir(parents=True, exist_ok=a.resume)
if (out / 'translation.json').exists():
    raise SystemExit('This evidence is already complete')

def call(*args):
    r = subprocess.run(['vps-preview', *args], capture_output=True, text=True, timeout=125)
    if r.returncode:
        raise RuntimeError(r.stderr or r.stdout)
    result = json.loads(r.stdout)
    if not result.get('ok'):
        raise RuntimeError(result)
    return result

segments = []
previous = sorted(out.glob('page-*.json'))
for path in previous:
    page = json.loads(path.read_text())
    if page['offset'] != len(segments):
        raise RuntimeError('Non-contiguous saved pages')
    segments.extend(page['segments'])
for page_number in range(len(previous), 80):
    deadline = time.monotonic() + 60
    while any(j['name'].startswith('pv-job-read-' + a.case + '-') and j.get('active')
              for j in call('status', 'atelier').get('jobs', [])):
        if time.monotonic() > deadline:
            raise RuntimeError('Previous reader still active')
        time.sleep(2)
    started = call('run', 'atelier', 'read-' + a.case)
    (out / f'run-{page_number:02}.json').write_text(json.dumps(started, indent=2))
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        response = call('logs', 'atelier', '--component', 'read-' + a.case)
        pages = [json.loads(line[5:]) for entry in response.get('logs', [])
                 for line in entry.get('log', '').splitlines() if line.startswith('PAGE ')]
        fresh = [page for page in pages if page['offset'] == len(segments)]
        if fresh:
            page = fresh[0]
            break
        time.sleep(2)
    else:
        raise RuntimeError('Reader page unavailable: inspect recorded job before resuming')
    (out / f'page-{page_number:02}.json').write_text(json.dumps(page, ensure_ascii=False, indent=2))
    segments.extend(page['segments'])
    print(a.case, page['next'], '/', page['total'], flush=True)
    if page['next'] == page['total']:
        (out / 'translation.json').write_text(json.dumps({'segments': segments}, ensure_ascii=False, indent=2))
        break
else:
    raise RuntimeError('Page bound exceeded')
