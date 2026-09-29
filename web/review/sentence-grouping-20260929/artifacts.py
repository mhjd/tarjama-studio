"""Prepare ASS/SRT and validate all actual libass cue bounds, without resegmenting."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

LAB = Path(__file__).resolve().parent
ROOT = LAB.parents[2]
OLD = LAB.parent/'conference-grouping-20260929'
sys.path.insert(0, str(OLD))
import prepare as original
IMAGE = 'sha256:e9a5dff6011038495545b5959cf685de8a9abc13f3711c8457fb3cb1be04530e'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', choices=['dev-s1','reserved-dedew-s1','control-news-s1'])
    args = parser.parse_args()
    run = ROOT/'web/.cache/sentence-grouping-20260929'/args.run
    groups = json.loads((run/'results/sentence.json').read_text())
    out = run/'render-validation'
    out.mkdir(mode=0o700, exist_ok=False)
    ass, srt = original.header(), ''
    for i,g in enumerate(groups,1):
        body = original.escape(g['text']) if g['exceptions'] else '\\N'.join(original.escape(line) for line in g['lines'])
        ass += f"Dialogue: 0,{original.timestamp(g['start_ms'],True)},{original.timestamp(g['end_ms'],True)},Default,,0,0,0,,{body}\n"
        srt += f"{i}\n{original.timestamp(g['start_ms'])} --> {original.timestamp(g['end_ms'])}\n" + '\n'.join(g['lines'])+'\n\n'
    (out/'subtitles.ass').write_text(ass)
    (out/'sentence-aware.srt').write_text(srt)
    (out/'partition.json').write_text(json.dumps(groups,ensure_ascii=False,indent=2)+'\n')
    base = ['docker','run','--rm','--init','--network','none','--read-only','--cap-drop','ALL',
            '--security-opt','no-new-privileges=true','--pids-limit','128','--cpus','2','--memory','512m',
            '--user',f'{os.getuid()}:{os.getgid()}','--tmpfs','/tmp:rw,nosuid,nodev,size=64m',
            '-e','XDG_CACHE_HOME=/tmp/cache','-v',f'{OLD}:/lab:ro','-v',f'{out}:/output',
            '--entrypoint','timeout',IMAGE,'-k','5','120']
    start = time.monotonic()
    with (out/'layout.stdout.log').open('wb') as stdout, (out/'layout.stderr.log').open('wb') as stderr:
        result = subprocess.run(base+['python3','-B','/lab/verify_layout.py'],stdout=stdout,stderr=stderr,timeout=140)
    (out/'validation.json').write_text(json.dumps(dict(image=IMAGE,returncode=result.returncode,seconds=time.monotonic()-start))+'\n')
    if result.returncode:
        raise SystemExit(f'Layout failed, see {out}')
    print(out)


if __name__ == '__main__':
    main()
