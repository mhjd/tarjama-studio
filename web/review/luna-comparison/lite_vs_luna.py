"""Matched replay on known corpus. One retry per block; no repair or fallback."""
from concurrent.futures import ProcessPoolExecutor
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request
import run

ARMS = [('luna-medium', 'openai/gpt-6-luna', 'responses', 'medium', 'openai', 'OpenAI'),
        ('gemini31-high', 'google/gemini-3.1-flash-lite', 'chat', 'high', 'google-ai-studio', 'Google AI Studio')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--candidate', choices=['gemini35'], help='Run only Gemini 3.5 Lite against archived comparators')
    args = parser.parse_args()
    arms = ([('gemini35-high', 'google/gemini-3.5-flash-lite', 'chat', 'high', 'google-ai-studio', 'Google AI Studio')]
            if args.candidate == 'gemini35' else ARMS)
    out = Path(args.output); out.mkdir(parents=True, exist_ok=False, mode=0o700)
    corpus = json.loads((run.ROOT / 'web/review/translation-lite/corpus.json').read_text())
    prompt = (run.ROOT / 'web/backend/internal/studio/prompts/translate.txt').read_text()
    ranges = run.timed_ranges(corpus, 4)
    assert len(ranges) == 4
    catalog = json.load(urllib.request.urlopen('https://openrouter.ai/api/v1/models', timeout=30))['data']
    selected = [x for x in catalog if x['id'] in [a[1] for a in arms]]
    run.save(out / 'models.json', selected)
    for label, model, api, effort, provider, expected in arms:
        metadata = next(x for x in selected if x['id'] == model)
        if effort not in (metadata.get('reasoning') or {}).get('supported_efforts', []):
            raise ValueError('unsupported_reasoning')
        endpoints = json.load(urllib.request.urlopen('https://openrouter.ai/api/v1/models/' + model + '/endpoints', timeout=30))
        run.save(out / (label + '-endpoints.json'), endpoints)
        if not any(e['tag'].split('/')[0] == provider and e['provider_name'] == expected for e in endpoints['data']['endpoints']):
            raise ValueError('provider_missing')
    run.save(out / 'protocol.json', {'arms': arms, 'ranges': ranges, 'max_calls': len(arms) * 8,
        'max_attempts_per_block': 2, 'timeout_seconds': 300, 'cost_stop_between_calls_usd': 2,
        'no_output_limit': True, 'continuity': True, 'context_lines': 5,
        'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(), 'prompt': prompt,
        'corpus_sha256': hashlib.sha256(json.dumps(corpus, ensure_ascii=False).encode()).hexdigest(),
        'known_corpus': True, 'strict_schema': True, 'repair': False})
    (out / 'runner-used.py').write_text(Path(__file__).read_text())
    (out / 'base-runner-used.py').write_text(Path(run.__file__).read_text())
    key = Path('/etc/vps-agent-secrets/openrouter.api_key').read_text().strip()
    if not key: raise ValueError('missing_key')
    states = {a[0]: {'summary': '', 'translations': {}, 'active': True, 'valid_blocks': 0} for a in arms}
    results = []
    for index, (lo, hi) in enumerate(ranges):
        for label, model, api, effort, provider, expected in (arms if index % 2 == 0 else list(reversed(arms))):
            state = states[label]
            if not state['active']: continue
            context = [{'id': s['id'], 'arabic': s['arabic'], 'french': state['translations'][s['id']]}
                       for s in corpus[max(0, lo-5):lo]]
            for attempt in (1, 2):
                if sum((s.get('usage') or {}).get('cost', 0) or 0 for s in results) >= 2:
                    state['active'] = False
                    state['stopped'] = 'cost_threshold'
                    break
                case = f'{label}-block-{index+1}-attempt-{attempt}'
                with ProcessPoolExecutor(max_workers=1) as pool:
                    result = pool.submit(run.run_call, out, model, case, prompt, corpus[lo:hi], key,
                        context_source=context, api=api, reasoning=effort, timeout_seconds=300,
                        continuity=True, previous_summary=state['summary'], provider=provider,
                        expected_provider=expected, no_output_limit=True).result()
                results.append(result)
                if result['valid']:
                    answer = json.loads((out / (case + '-' + model.split('/')[1]) / 'translation.json').read_text())
                    state['summary'] = answer['continuity_summary']
                    state['translations'].update({s['id']: s['text'] for s in answer['segments']})
                    state['valid_blocks'] += 1
                    break
                # Retry only a completed response rejected by parsing/validation, never auth, timeout or routing failures.
                if result.get('error') not in ['JSONDecodeError', 'ValueError'] or result.get('provenance_error') or result.get('http_status') != 200:
                    state['active'] = False
                    state['stopped'] = 'non_retryable_failure'
                    break
                if attempt == 2:
                    state['active'] = False
                    state['stopped'] = 'two_invalid_attempts'
    run.save(out / 'results.json', results)
    run.save(out / 'states.json', states)
    run.save(out / 'hashes.json', {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*.json'))})


if __name__ == '__main__':
    main()
