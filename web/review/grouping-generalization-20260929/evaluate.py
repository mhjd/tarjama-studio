"""Deterministic offline comparison. Output must not exist; never calls an API."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import unicodedata
from candidate import original, partition, words


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pairs(source):
    result, i = [], 0
    while i < len(source):
        j = i
        if i + 1 < len(source):
            left, right = source[i], source[i + 1]
            text = original.text_of(left) + ' ' + original.text_of(right)
            chars = len(unicodedata.normalize('NFC', text))
            duration = right['end_ms'] - left['start_ms']
            gap = right['start_ms'] - left['end_ms']
            if (words(original.text_of(left)) < 10 and words(original.text_of(right)) < 10
                    and -10 <= gap <= 500 and 0 < duration <= 7000
                    and chars <= 84 and chars * 1000 <= duration * 17):
                j += 1
        result.append(dict(first=i, last=j, start_ms=source[i]['start_ms'],
                           end_ms=source[j]['end_ms'],
                           text=' '.join(original.text_of(s) for s in source[i:j + 1])))
        i = j + 1
    return result


def distribution(values):
    v = sorted(values)
    return dict(min=v[0], median=v[len(v)//2], p95=v[min(len(v)-1, int(len(v)*.95))], max=v[-1])


def metrics(groups, source):
    durations = [g['end_ms'] - g['start_ms'] for g in groups]
    speeds = [len(unicodedata.normalize('NFC', g['text'])) * 1000 / d
              for g, d in zip(groups, durations)]
    gaps = [source[k + 1]['start_ms'] - source[k]['end_ms']
            for g in groups for k in range(g['first'], g['last'])]
    anticipation = [source[g['last']]['start_ms'] - g['start_ms'] for g in groups]
    return dict(cues=len(groups), one_word=sum(words(g['text']) == 1 for g in groups),
                fleeting=sum(d * 6 < 5000 for d in durations),
                above_17_cps=sum(s > 17 for s in speeds), above_21_cps=sum(s > 21 for s in speeds),
                duration_ms=distribution(durations), cps=distribution(speeds),
                max_anticipation_ms=max(anticipation), gaps_over_500ms=sum(g > 500 for g in gaps),
                max_gap_ms=max(gaps, default=0), unchanged_input_cues=sum(g['first']==g['last'] for g in groups),
                exceptions=sum(bool(g['exceptions']) for g in groups) if all('exceptions' in g for g in groups) else None)


def verify(groups, source):
    assert ' '.join(g['text'] for g in groups) == ' '.join(original.text_of(s) for s in source)
    assert [i for g in groups for i in range(g['first'], g['last']+1)] == list(range(len(source)))
    for g in groups:
        assert g['start_ms'] == source[g['first']]['start_ms']
        assert g['end_ms'] == source[g['last']]['end_ms']
        if 'exceptions' in g and g['first'] != g['last']:
            assert not g['exceptions'] and len(g['lines']) <= 2
            assert g['end_ms'] - g['start_ms'] <= 7000


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, required=True)
    p.add_argument('--translation', type=Path)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    started = time.monotonic()
    data = json.loads(args.input.read_text())
    source = data if isinstance(data, list) else data['segments']
    if args.translation:
        translated = json.loads(args.translation.read_text())['segments']
        assert [x['id'] for x in source] == [x['id'] for x in translated]
        source = [dict(s, french=t['text']) for s,t in zip(source, translated)]
    for i, s in enumerate(source):
        assert s['end_ms'] > s['start_ms'] >= 0 and original.text_of(s)
        if i:
            assert s['start_ms'] >= source[i-1]['end_ms']
    measure = original.Measure()
    layout, fallback = original.layout_functions(measure)
    arms = dict(pairs=pairs(source), prototype=original.partition(source, layout, fallback),
                candidate_b=partition(source, layout, fallback))
    for name, groups in arms.items():
        verify(groups, source)
        (args.output/(name+'.json')).write_text(json.dumps(groups, ensure_ascii=False, indent=2)+'\n')
    result = dict(input_sha256=digest(args.input),
                  translation_sha256=digest(args.translation) if args.translation else None,
                  sources={p.name:digest(p) for p in [Path(__file__), Path(__file__).with_name('candidate.py'), Path(original.__file__)]},
                  metrics={name:metrics(groups, source) for name,groups in arms.items()},
                  seconds=round(time.monotonic()-started, 3), invariants_passed=True)
    (args.output/'summary.json').write_text(json.dumps(result, indent=2)+'\n')
    # One row per changed boundary, with neighbouring output cues on both arms.
    differences = []
    for name in ['pairs', 'prototype']:
        old = {g['last'] for g in arms[name][:-1]}
        new = {g['last'] for g in arms['candidate_b'][:-1]}
        for boundary in sorted(old ^ new):
            def context(groups):
                index = next(i for i,g in enumerate(groups) if g['first'] <= boundary <= g['last'])
                return groups[max(0,index-1):index+3]
            differences.append(dict(comparator=name, boundary=boundary,
                                    time_ms=source[boundary]['end_ms'],
                                    change='removed' if boundary in old else 'added',
                                    before=context(arms[name]), after=context(arms['candidate_b'])))
    (args.output/'boundaries.json').write_text(json.dumps(differences, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
