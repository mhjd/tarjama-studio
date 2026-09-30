"""Production S1; parity-qualified against frozen experiment 96656a9."""
from fractions import Fraction
from pathlib import Path
import re
import sys
import unicodedata
import layout as original
from sentences import SentenceMap


def words(text):
    return sum(any(c.isalnum() for c in field) for field in text.split())


def clause_boundary(text):
    return bool(re.search(r'[,;:—–]\s*[»”"\']?$', text.rstrip()))


def partition(source, layout, fallback, sentences=None):
    sentences = sentences or SentenceMap(source)
    n = len(source)
    best, choice = [None]*(n+1), [None]*n
    best[n] = (0,)*9
    for i in range(n-1, -1, -1):
        text = ''
        for j in range(i, n):
            if j>i and source[j]['end_ms']-source[i]['start_ms'] > original.MAX_MS:
                break
            text = (text+' '+original.text_of(source[j])).strip()
            if j>i and len(unicodedata.normalize('NFC', text)) > 85:
                break
            cue = original.candidate(source, i, j, layout, fallback)
            if cue is None:
                continue
            internal = int(sentences.internal_cut(j))
            dangling = int(internal and original.boundary_cost(text) == 3)
            word_count = sentences.segment_words[j][1]-sentences.segment_words[i][0]
            gaps = sum(source[k+1]['start_ms']-source[k]['end_ms'] for k in range(i,j))
            score = (len(cue['exceptions']), internal, int(internal and not clause_boundary(text)),
                     dangling, sentences.imbalance(i,j), 1, word_count**2,
                     int(cue['cps']>original.PREFERRED_CPS), gaps)
            total = tuple(a+b for a,b in zip(score, best[j+1]))
            if best[i] is None or total < best[i]:
                best[i], choice[i] = total, cue
    result, i = [], 0
    while i<n:
        cue = choice[i]
        assert cue is not None
        result.append(cue)
        i = cue['last']+1
    return result
