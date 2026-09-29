"""Bounded isolated experiment; no live storage, secrets, or network mounted."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

LAB = Path(__file__).resolve().parent
ROOT = LAB.parents[2]
OUTPUT = ROOT / 'web/.cache/grouping-generalization-20260929'
OLD = LAB.parent / 'conference-grouping-20260929'
HIST = ROOT / 'data/model_outputs/luna-comparison-20260924-01/corpus-deepseek-v4.1-flash'
INPUTS = {
    'dev': [(Path('/home/codex/.tarjama-sirat-grouping-input/segments.json'), '/input.json')],
    'historical': [(HIST / 'input.json', '/input.json'), (HIST / 'translation.json', '/translation.json')],
    'short': [(ROOT / 'web/.cache/real-ui-10min/ui-review-tenmin_short3/transcription-macbook-air15-m4.json', '/input.json')],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', choices=INPUTS)
    parser.add_argument('--run', required=True, help='New exclusive result directory name')
    args = parser.parse_args()
    if not args.run.replace('-', '').replace('_', '').isalnum():
        parser.error('Use a simple run name')
    if args.dataset != 'dev' and not (LAB / 'SELECTION.json').is_file():
        parser.error('Freeze candidate selection before opening reserved datasets')
    sources = [LAB / 'candidate.py', LAB / 'evaluate.py', OLD / 'prepare.py']
    hashes = {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    if args.dataset != 'dev':
        frozen = json.loads((LAB / 'SELECTION.json').read_text())
        if hashes != frozen['sources']:
            parser.error('Candidate differs from the frozen selection')
    out = OUTPUT / args.run
    out.mkdir(parents=True, exist_ok=False, mode=0o700)
    image = subprocess.check_output(['docker', 'image', 'inspect', 'tarjama-web-tools:test', '--format', '{{.Id}}'], text=True).strip()
    name = 'tarjama-grouping-' + args.run
    command = ['docker', 'run', '--rm', '--init', '--name', name, '--network', 'none',
               '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true',
               '--cpus', '2', '--memory', '1536m', '--pids-limit', '128',
               '--user', f'{os.getuid()}:{os.getgid()}',
               '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m', '-e', 'XDG_CACHE_HOME=/tmp/cache',
               '-v', f'{LAB}:/lab/grouping-generalization-20260929:ro',
               '-v', f'{OLD}:/lab/conference-grouping-20260929:ro', '-v', f'{out}:/output']
    for path, target in INPUTS[args.dataset]:
        command += ['-v', f'{path}:{target}:ro']
    command += ['--entrypoint', 'timeout', image, '-k', '10', '600', 'python3', '-B',
                '/lab/grouping-generalization-20260929/evaluate.py', '--input', '/input.json',
                '--output', '/output/results']
    if args.dataset == 'historical':
        command += ['--translation', '/translation.json']
    record = dict(dataset=args.dataset, sources=hashes, image=image, command=command,
                  inputs={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p,t in INPUTS[args.dataset]})
    (out / 'launch.json').write_text(json.dumps(record, indent=2)+'\n')
    start = time.monotonic()
    with (out / 'stdout.log').open('wb') as stdout, (out / 'stderr.log').open('wb') as stderr:
        try:
            result = subprocess.run(command, stdout=stdout, stderr=stderr, timeout=620)
            code = result.returncode
        except subprocess.TimeoutExpired:
            code = 124
        finally:
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    (out / 'exit.json').write_text(json.dumps(dict(returncode=code, seconds=time.monotonic()-start))+'\n')
    print(out)
    raise SystemExit(code)


if __name__ == '__main__':
    main()
