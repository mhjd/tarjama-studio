"""Offline candidate B. No media, project or deployment writes."""
import sys
from pathlib import Path
import unicodedata

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'conference-grouping-20260929'))
import prepare as original


def words(text):
    return sum(any(c.isalnum() for c in field) for field in text.split())


def partition(segments, layout, fallback):
    n = len(segments)
    best, choices = [None] * (n + 1), [None] * n
    best[n] = (0,) * 10
    for i in range(n - 1, -1, -1):
        text = ''
        for j in range(i, n):
            if j > i and segments[j]['end_ms'] - segments[i]['start_ms'] > original.MAX_MS:
                break
            text = (text + ' ' + original.text_of(segments[j])).strip()
            if j > i and len(unicodedata.normalize('NFC', text)) > 85:
                break
            cue = original.candidate(segments, i, j, layout, fallback)
            if cue is None:
                continue
            boundary = original.boundary_cost(text) if j < n - 1 else 0
            internal = sum(original.boundary_cost(original.text_of(segments[k])) == 0
                           for k in range(i, j))
            gaps = sum(segments[k + 1]['start_ms'] - segments[k]['end_ms'] for k in range(i, j))
            # Preserve a complete idea rather than append the next idea's prefix.
            # Same terminal-punctuation heuristic as A; no domain vocabulary.
            crosses_into_unfinished = internal > 0 and original.boundary_cost(text) != 0
            score = (int((cue['end_ms'] - cue['start_ms']) * 6 < 5000),
                     int(words(text) == 1), int(crosses_into_unfinished),
                     len(cue['exceptions']), internal, int(boundary == 3),
                     int(boundary >= 2), int(cue['cps'] > original.PREFERRED_CPS), 1, gaps)
            total = tuple(a + b for a, b in zip(score, best[j + 1]))
            if best[i] is None or total < best[i]:
                best[i], choices[i] = total, cue
    groups, i = [], 0
    while i < n:
        cue = choices[i]
        assert cue is not None
        groups.append(cue)
        i = cue['last'] + 1
    return groups
