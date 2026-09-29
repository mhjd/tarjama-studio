"""ICU sentence boundaries, with standard French abbreviation filtering.

Uses the existing system ICU library. No model download or corpus-specific rules.
Offsets returned to Python are Unicode code points, not UTF-16 code units.
"""
from bisect import bisect_left
import ctypes as C
import ctypes.util
from fractions import Fraction
import re


class ICU:
    def __init__(self):
        name = ctypes.util.find_library('icuuc')
        if not name:
            raise RuntimeError('System ICU library is required')
        self.lib = C.CDLL(name)
        match = re.search(r'\.so\.(\d+)', name)
        self.version = match.group(1) if match else 'unversioned'
        suffix = '_' + match.group(1) if match else ''
        signatures = {
            'open': ([C.c_int32, C.c_char_p, C.POINTER(C.c_uint16), C.c_int32, C.POINTER(C.c_int32)], C.c_void_p),
            'first': ([C.c_void_p], C.c_int32),
            'next': ([C.c_void_p], C.c_int32),
            'close': ([C.c_void_p], None),
        }
        for name, (args, result) in signatures.items():
            fn = getattr(self.lib, 'ubrk_' + name + suffix)
            fn.argtypes, fn.restype = args, result
            setattr(self, name, fn)

    def spans(self, text):
        encoded = text.encode('utf-16-le')
        data = (C.c_uint16 * (len(encoded)//2)).from_buffer_copy(encoded)
        error = C.c_int32(0)
        iterator = self.open(3, b'fr@ss=standard', data, len(data), C.byref(error))
        if error.value > 0 or not iterator:
            raise RuntimeError(f'ICU sentence iterator error {error.value}')
        result, offset = [], 0
        try:
            previous = self.first(iterator)
            while True:
                end = self.next(iterator)
                if end == -1:
                    break
                length = len(encoded[previous*2:end*2].decode('utf-16-le'))
                result.append((offset, offset+length))
                previous, offset = end, offset+length
        finally:
            self.close(iterator)
        assert offset == len(text)
        return result


class SentenceMap:
    def __init__(self, segments, icu=None):
        self.icu = icu or ICU()
        texts = [' '.join(s['french'].split()) for s in segments]
        self.text = ' '.join(texts)
        self.tokens = [m for m in re.finditer(r'\S+', self.text) if any(c.isalnum() for c in m.group())]
        starts = [m.start() for m in self.tokens]
        self.sentences = []
        for a, b in self.icu.spans(self.text):
            lo, hi = bisect_left(starts, a), bisect_left(starts, b)
            if lo < hi:
                self.sentences.append(dict(lo=lo, hi=hi, text=self.text[a:b].strip()))
        self.ends = [s['hi'] for s in self.sentences]
        self.segment_words = []
        pos = 0
        for text in texts:
            self.segment_words.append((bisect_left(starts, pos), bisect_left(starts, pos+len(text))))
            pos += len(text)+1
        assert sum(s['hi']-s['lo'] for s in self.sentences) == len(self.tokens)

    def parts(self, first, last):
        lo, hi = self.segment_words[first][0], self.segment_words[last][1]
        result = []
        for index in range(bisect_left(self.ends, lo+1), len(self.sentences)):
            sentence = self.sentences[index]
            if sentence['lo'] >= hi:
                break
            a, b = max(lo, sentence['lo']), min(hi, sentence['hi'])
            result.append(dict(sentence=index, words=b-a, total=sentence['hi']-sentence['lo'],
                               first=a == sentence['lo'], last=b == sentence['hi']))
        return result

    def internal_cut(self, last):
        end = self.segment_words[last][1]
        return last < len(self.segment_words)-1 and end not in self.ends

    def imbalance(self, first, last):
        return sum((Fraction(p['words']**2, p['total']**2) for p in self.parts(first,last)), Fraction(0))

    def orphans(self, groups):
        result = []
        for i, group in enumerate(groups):
            for part in self.parts(group['first'], group['last']):
                if part['words'] == 1 and part['total'] > 1:
                    result.append(dict(cue=i, **part,
                                       position='prefix' if part['first'] else 'suffix' if part['last'] else 'middle'))
        return result
