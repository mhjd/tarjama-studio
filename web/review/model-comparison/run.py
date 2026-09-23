"""Opt-in, six-call translation comparison; never changes the hosted app.

The native process consumes the registered key. No headers, secrets or raw error
bodies are persisted or printed. Each run requires a new immutable directory.
"""
import argparse
import hashlib
import json
import signal
from pathlib import Path
import time
import unicodedata
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
MODELS = ['google/gemini-3.5-flash-lite', 'deepseek/deepseek-v4.1-flash']
MAX_BYTES = 4 * 1024 * 1024


def save(path, value):
    with path.open('x', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)


def validate(result, source):
    if not isinstance(result, dict) or set(result) != {'segments'}:
        raise ValueError('invalid root')
    rows = result['segments']
    if not isinstance(rows, list) or len(rows) != len(source):
        raise ValueError('invalid segment count')
    for row, original in zip(rows, source):
        if not isinstance(row, dict) or set(row) != {'id', 'text'} or row['id'] != original['id']:
            raise ValueError('invalid ID/order/fields')
        text = row['text']
        if not isinstance(text, str) or not text.strip() or len(text.encode()) > 16000:
            raise ValueError('invalid text')
        if '<!--' in text or any(c == '\0' or unicodedata.category(c) == 'Co' for c in text):
            raise ValueError('technical marker')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def deadline_expired(signum, frame):
    raise TimeoutError("provider deadline")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=False)
    out.chmod(0o700)
    prompt = (ROOT / 'web/backend/internal/studio/prompts/translate.txt').read_text()
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open('https://openrouter.ai/api/v1/models', timeout=30) as response:
        models = json.load(response)['data']
    selected = [m for m in models if m['id'] in MODELS]
    if len(selected) != 2:
        raise ValueError('requested model missing')
    save(out / 'models.json', selected)
    save(out / 'protocol.json', {'models': MODELS, 'calls': 6, 'max_tokens': 32768,
        'reasoning': 'provider/model defaults (recorded in models.json)',
        'temperature': 'default', 'retries': 0, 'timeout_seconds': 600,
        'max_price_usd_per_million': {'prompt': 0.30, 'completion': 2.50},
        'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(),
        'system_prompt': prompt})
    # The key is consumed only in this process, never returned to the agent.
    key = Path('/etc/vps-agent-secrets/openrouter.api_key').read_text().strip()
    if not key:
        raise ValueError('registered key unavailable')
    schema = {'type': 'object', 'additionalProperties': False,
        'properties': {'segments': {'type': 'array', 'items': {'type': 'object',
            'additionalProperties': False, 'properties': {'id': {'type': 'string'},
            'text': {'type': 'string'}}, 'required': ['id', 'text']}}}, 'required': ['segments']}
    signal.signal(signal.SIGALRM, deadline_expired)
    summaries = []
    # Reverse order on the repeated small fixture to reduce order bias.
    for case, order in [('challenges-1', MODELS), ('corpus', MODELS[::-1]), ('challenges-2', MODELS[::-1])]:
        fixture = 'corpus' if case == 'corpus' else 'challenges'
        source = json.loads((ROOT / f'web/review/translation-lite/{fixture}.json').read_text())
        for model in order:
            directory = out / (case + '-' + model.split('/')[0])
            directory.mkdir(mode=0o700)
            save(directory / 'input.json', source)
            user = {'segments': [{'id': s['id'], 'text': s['arabic']} for s in source], 'context_only': []}
            body = {'model': model, 'messages': [{'role': 'system', 'content': prompt},
                {'role': 'user', 'content': json.dumps(user, ensure_ascii=False)}], 'max_tokens': 32768,
                'response_format': {'type': 'json_schema', 'json_schema': {'name': 'translation', 'strict': True, 'schema': schema}},
                'provider': {'require_parameters': True, 'max_price': {'prompt': 0.30, 'completion': 2.50}}}
            save(directory / 'request.json', body)
            request = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions',
                data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
            summary = {'case': case, 'model_requested': model, 'segments': len(source), 'valid': False}
            start = time.monotonic()
            try:
                signal.alarm(600)
                with opener.open(request, timeout=600) as response:
                    summary['http_status'] = response.status
                    raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise ValueError('oversized response')
                # Defensive redaction even in a successful provider response.
                result = json.loads(raw.decode().replace(key, '[REDACTED]'))
                save(directory / 'response.raw.json', result)
                summary.update({k: result.get(k) for k in ('model', 'provider', 'usage')})
                choices = result.get('choices', [])
                if len(choices) != 1:
                    raise ValueError('invalid choices')
                summary['finish_reason'] = choices[0].get('finish_reason')
                code = choices[0].get('error', {}).get('code')
                if isinstance(code, int):
                    summary['provider_error_code'] = code
                if summary['finish_reason'] != 'stop':
                    raise ValueError('non-stop completion')
                translated = json.loads(choices[0]['message']['content'])
                validate(translated, source)
                save(directory / 'translation.json', translated)
                summary['valid'] = True
            except urllib.error.HTTPError as exc:
                summary.update(http_status=exc.code, error='HTTP error; body intentionally not logged')
                exc.close()
            except Exception as exc:
                # Exception text could contain provider data. Only a class is safe.
                summary['error'] = type(exc).__name__
            finally:
                signal.alarm(0)
            summary['elapsed_seconds'] = round(time.monotonic() - start, 3)
            save(directory / 'summary.json', summary)
            summaries.append(summary)
            print(json.dumps(summary), flush=True)
            if summary.get('http_status') in (401, 402, 403):
                save(out / 'summary.json', summaries)
                return 1
    save(out / 'summary.json', summaries)
    return 0 if all(s['valid'] for s in summaries) else 1


if __name__ == '__main__':
    # No tracebacks: urllib request internals must never leak credentials.
    try:
        raise SystemExit(main())
    except Exception as error:
        print('Benchmark stopped: ' + type(error).__name__)
        raise SystemExit(1)
