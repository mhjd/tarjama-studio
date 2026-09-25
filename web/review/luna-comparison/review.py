"""One paid blind revision call on the saved Luna medium translation. No retries."""
import argparse
import hashlib
import json
from pathlib import Path
import signal
import time
import urllib.request
import urllib.error
import run

MODEL = 'openai/gpt-6-luna'
FIELDS = {'id', 'before', 'after', 'explanation', 'confidence'}
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['issues'],
    'properties': {'issues': {'type': 'array', 'items': {'type': 'object',
    'additionalProperties': False, 'required': sorted(FIELDS), 'properties': {
        'id': {'type': 'string'}, 'before': {'type': 'string'}, 'after': {'type': 'string'},
        'explanation': {'type': 'string'}, 'confidence': {'type': 'string', 'enum': ['certain', 'probable', 'uncertain']}}}}}}


def validate_review(answer, rows):
    if not isinstance(answer, dict) or set(answer) != {'issues'} or not isinstance(answer['issues'], list):
        raise ValueError('invalid_review_root')
    originals = {r['id']: r['french'] for r in rows}
    seen = set()
    for issue in answer['issues']:
        if not isinstance(issue, dict) or set(issue) != FIELDS:
            raise ValueError('invalid_issue')
        if any(not isinstance(issue[k], str) or not issue[k].strip() for k in FIELDS):
            raise ValueError('invalid_issue_text')
        sid = issue['id']
        if sid not in originals or sid in seen or issue['before'] != originals[sid]:
            raise ValueError('invalid_issue_reference')
        if issue['after'] == issue['before'] or issue['confidence'] not in ['certain', 'probable', 'uncertain']:
            raise ValueError('invalid_change')
        seen.add(sid)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--no-output-limit', action='store_true', help='Omit caller-imposed output token limit; provider/model defaults apply')
    parser.add_argument('--model', choices=[MODEL, 'google/gemini-3.8-flash'], default=MODEL)
    args = parser.parse_args()
    model = args.model
    gemini = model == 'google/gemini-3.8-flash'
    api = 'chat' if gemini else 'responses'
    provider = 'google-ai-studio' if gemini else 'openai'
    expected_provider = 'Google AI Studio' if gemini else 'OpenAI'

    out = Path(args.output); out.mkdir(parents=True, exist_ok=False); out.chmod(0o700)
    source_path = run.ROOT / 'web/review/translation-lite/corpus.json'
    baseline_path = Path(__file__).with_name('recovery-results-20260924.json')
    source = json.loads(source_path.read_text())
    baseline = json.loads(baseline_path.read_text())['translation']
    run.validator.validate(baseline, source)
    rows = [{**s, 'french': t['text']} for s, t in zip(source, baseline['segments'])]
    prompt = Path(__file__).with_name('review-prompt.txt').read_text()
    run.save(out / 'input.json', rows)
    run.save(out / 'protocol.json', {'model': model, 'api': api, 'provider': provider, 'reasoning': 'medium', 'calls_max': 1,
        'retries': 0, 'timeout_seconds': 300, 'review_span_seconds': 940.7,
        'caller_output_token_limit': None if args.no_output_limit else 8192,
        'source_sha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
        'baseline_sha256': hashlib.sha256(baseline_path.read_bytes()).hexdigest(),
        'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(), 'known_errors_supplied': False})
    with (out / 'review-used.py').open('x') as f: f.write(Path(__file__).read_text())
    with (out / 'prompt-used.txt').open('x') as f: f.write(prompt)
    tools = json.loads(json.dumps(run.TOOLS))
    tools[0]['parameters'].update(max_uses=2, max_total_results=40)
    tools[1]['parameters'].update(max_uses=2, max_content_tokens=4000)
    body = {'model': model, 'instructions': prompt,
        'input': [{'type': 'message', 'role': 'user', 'content': [{'type': 'input_text',
                   'text': json.dumps({'segments': rows}, ensure_ascii=False)}]}],
        'reasoning': {'effort': 'medium'}, 'max_output_tokens': 8192, 'store': False,
        'text': {'format': {'type': 'json_schema', 'name': 'translation_review', 'strict': True, 'schema': SCHEMA}},
        'tools': tools, 'tool_choice': 'auto', 'max_tool_calls': 4,
        'provider': {'only': [provider], 'order': [provider], 'allow_fallbacks': False,
                     'require_parameters': True, 'max_price': {'prompt': 1, 'completion': 4 if gemini else 3}}}
    if gemini:
        body['messages'] = [{'role': 'system', 'content': body.pop('instructions')},
                            {'role': 'user', 'content': body.pop('input')[0]['content'][0]['text']}]
        body['max_tokens'] = body.pop('max_output_tokens')
        body.pop('store')
        fmt = body.pop('text')['format']
        body['response_format'] = {'type': 'json_schema', 'json_schema': {
            'name': fmt['name'], 'strict': fmt['strict'], 'schema': fmt['schema']}}
    if args.no_output_limit:
        body.pop('max_tokens', None)
        body.pop('max_output_tokens', None)
    run.save(out / 'request.json', body)
    key = Path('/etc/vps-agent-secrets/openrouter.api_key').read_text().strip()
    if not key: raise ValueError('missing_credential')
    summary = {'valid': False, 'model': model}; start = time.monotonic()
    signal.signal(signal.SIGALRM, run.deadline_expired); signal.alarm(300)
    try:
        req = urllib.request.Request('https://openrouter.ai/api/v1/' + ('chat/completions' if gemini else 'responses'), data=json.dumps(body).encode(),
                 headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
        opener = urllib.request.build_opener(run.NoRedirect())
        with opener.open(req, timeout=300) as response:
            raw = response.read(run.MAX_BYTES + 1)
            summary['http_status'] = response.status
        if len(raw) > run.MAX_BYTES: raise ValueError('response_too_large')
        result = json.loads(raw)
        result = json.loads(json.dumps(result).replace(key, '[redacted]'))
        run.save(out / 'response.json', result)
        summary.update({k: result.get(k) for k in ['id', 'model', 'usage', 'status']})
        if result.get('model') != model: raise ValueError('unexpected_model')
        metadata = run.generation_metadata(opener, key, result.get('id'))
        run.save(out / 'generation.json', metadata)
        summary['generation_provider'] = metadata.get('provider_name')
        summary['generation_model'] = metadata.get('model')
        if not run.provenance_matches(metadata, result.get('id'), model, expected_provider):
            raise ValueError('unverified_provenance')
        answer = json.loads(run.final_text(result, api))
        validate_review(answer, rows)
        run.save(out / 'review.json', answer)
        summary.update(valid=True, issues=len(answer['issues']))
    except urllib.error.HTTPError as exc:
        summary.update(http_status=exc.code, error='provider_http_error')
    except Exception as exc:
        summary['error'] = type(exc).__name__
    finally: signal.alarm(0)
    summary['elapsed_seconds'] = round(time.monotonic() - start, 3)
    run.save(out / 'summary.json', summary)
    run.save(out / 'hashes.json', {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest()
                                 for p in sorted(out.iterdir()) if p.is_file()})
    print(json.dumps(summary), flush=True)


if __name__ == '__main__': main()
