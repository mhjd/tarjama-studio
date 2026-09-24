"""Replay one failed corpus part as two halves; no app configuration changes."""
import argparse
import hashlib
import json
from pathlib import Path
import run

p = argparse.ArgumentParser()
p.add_argument('--output', required=True)
p.add_argument('--part', type=int, choices=range(1, 5), required=True)
a = p.parse_args()
out = Path(a.output)
out.mkdir(parents=True, exist_ok=False, mode=0o700)
corpus = json.loads((run.ROOT / 'web/review/translation-lite/corpus.json').read_text())
prompt = (run.ROOT / 'web/backend/internal/studio/prompts/translate.txt').read_text()
size = (len(corpus) + 3) // 4
start, end = (a.part - 1) * size, min(a.part * size, len(corpus))
mid = (start + end) // 2
run.save(out / 'protocol.json', dict(model=run.MODELS[0], api='responses', reasoning='medium',
    max_calls=2, retries=0, part=a.part, range=[start,end], split_at=mid,
    prompt_sha256=hashlib.sha256(prompt.encode()).hexdigest()))
(out / 'runner-used.py').write_text(Path(__file__).read_text())
key = Path('/etc/vps-agent-secrets/openrouter.api_key').read_text().strip()
results = []
for number, (lo, hi) in enumerate([(start, mid), (mid, end)], 1):
    results.append(run.run_call(out, run.MODELS[0], f'part-{a.part}-half-{number}', prompt,
        corpus[lo:hi], key, context_source=corpus[max(0,lo-2):lo]+corpus[hi:hi+2],
        api='responses', reasoning='medium'))
    if results[-1].get('http_status') in [400,401,403,404,422]: break
run.save(out / 'results.json', results)
run.save(out / 'hashes.json', {str(f.relative_to(out)): hashlib.sha256(f.read_bytes()).hexdigest()
    for f in sorted(out.rglob('*.json'))})
