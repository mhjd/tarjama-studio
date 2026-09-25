"""Owner-launched, finite comparison. No agent lease and no automatic restart."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
MODELS = ('google/gemini-3.1-flash-lite', 'google/gemini-3.5-flash-lite')
MODEL_DEADLINE = 1500


def write_status(path, value):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(path)


def command(model, output):
    return [sys.executable, '-B', str(Path(__file__).with_name('run.py')),
            '--model', model, '--output', str(output), '--api', 'chat',
            '--provider', 'google-ai-studio', '--reasoning', 'high',
            '--chunk-minutes', '4', '--continuity', '--no-output-limit',
            '--timeout-seconds', '300']


def stop(child):
    if child is None:
        return
    # Kill the whole process group, including any API worker left behind.
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    time.sleep(1)
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait()


def result_state(folder, returncode):
    path = folder / 'results.json'
    calls = json.loads(path.read_text()) if path.exists() else []
    complete = returncode == 0 and len(calls) == 4 and all(c.get('valid') for c in calls)
    costs = [(c.get('usage') or {}).get('cost') for c in calls]
    return {'state': 'complete' if complete else 'incomplete',
            'returncode': returncode, 'calls_recorded': len(calls),
            'valid_blocks': sum(bool(c.get('valid')) for c in calls),
            'known_cost_usd': sum(c for c in costs if isinstance(c, (int, float))),
            'cost_may_be_incomplete': len(calls) == 0 or any(c is None for c in costs),
            'elapsed_seconds': sum(c.get('elapsed_seconds', 0) for c in calls)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Print commands; no network or secret access')
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    out = ROOT / 'data/model_outputs' / ('gemini-lite-pair-' + stamp)
    if args.dry_run:
        for model in MODELS:
            print(json.dumps(command(model, out / model.split('/')[1])))
        return 0
    os.umask(0o077)
    lock_path = ROOT / 'web/.cache/gemini-lite-benchmark.lock'
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('A Gemini Lite comparison is already running. No calls started.', flush=True)
            return 3
        out.mkdir(parents=True, exist_ok=False)
        (out / 'supervisor-used.py').write_text(Path(__file__).read_text())
        status = {'state': 'running', 'pid': os.getpid(), 'output': str(out),
                  'max_translation_calls': 8, 'retries': 0, 'models': {},
                  'model_deadline_seconds': MODEL_DEADLINE}
        status_path = out / 'status.json'
        write_status(status_path, status)
        print('RESULTS: ' + str(out), flush=True)
        child = None
        def interrupted(signum, frame):
            raise KeyboardInterrupt
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(sig, interrupted)
        try:
            for model in MODELS:
                name = model.split('/')[1]
                folder = out / name
                status['current_model'] = model
                write_status(status_path, status)
                print('START: ' + model, flush=True)
                with (out / (name + '.log')).open('x') as log:
                    child = subprocess.Popen(command(model, folder), cwd=ROOT,
                                             stdout=log, stderr=subprocess.STDOUT,
                                             start_new_session=True)
                    try:
                        code = child.wait(timeout=MODEL_DEADLINE)
                    except subprocess.TimeoutExpired:
                        stop(child)
                        status['models'][model] = {'state': 'timeout', 'cost_may_be_incomplete': True}
                    else:
                        status['models'][model] = result_state(folder, code)
                    finally:
                        stop(child)
                        child = None
                write_status(status_path, status)
                print('RESULT: ' + json.dumps(status['models'][model]), flush=True)
            status['state'] = ('complete' if all(x['state'] == 'complete' for x in status['models'].values())
                               else 'finished_with_failures')
        except KeyboardInterrupt:
            status['state'] = 'interrupted'
            status['cost_may_be_incomplete'] = True
        except Exception as exc:
            status['state'] = 'supervisor_error'
            status['error'] = type(exc).__name__
        finally:
            stop(child)
            write_status(status_path, status)
        print('FINISHED: ' + status['state'] + '\nRESULTS: ' + str(out), flush=True)
        return 0 if status['state'] == 'complete' else 2


if __name__ == '__main__':
    raise SystemExit(main())
