#!/usr/bin/env python3
"""Offline export prototype. No application imports, network, API or live writes.

Input: a read-only copy of timed French editing segments. Segments are indivisible.
Output: ASS, SRT and an auditable partition. libass measures the actual font width.
"""
import argparse
import ctypes as C
import ctypes.util
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
import unicodedata

WIDTH, HEIGHT, SIZE = 1920, 1080, 83
MARGIN, VMARGIN = 96, 63
MAX_MS, PREFERRED_CPS, MAX_CPS, LINE_CHARS = 7000, 17, 21, 42
# This is a transparent French heuristic, not a syntactic parser or a scientific
# claim that every entry is always incomplete (e.g. 'un' can be a numeral).
DANGLING = set('un une le la les des du de au aux ce cet cette ces mon ton son ma ta sa nos vos leurs et ou mais que qui dont lorsque puisque pour par avec dans sans sur sous vers chez ne se'.split())


def text_of(segment):
    return ' '.join(segment['french'].split())


def boundary_cost(text):
    t = text.rstrip(' »”\"’')
    if re.search(r'[.!?…]$', t):
        return 0
    if re.search(r'[,;:]$', t):
        return 1
    if t and (t.lower().split()[-1] in DANGLING or t.endswith(("'", '’'))):
        return 3
    return 2


def escape(text):
    return text.replace('\\', '＼').replace('{', '｛').replace('}', '｝')


def header(width=WIDTH, height=HEIGHT, margin=MARGIN, alignment=2):
    return f'''[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,{SIZE},&H00FFFFFF,&H000000FF,&H00000000,&HC0000000,0,0,0,0,100,100,0,0,3,1,0,{alignment},{margin},{margin},{VMARGIN},1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''


class AssImage(C.Structure):
    pass


AssImage._fields_ = [('w', C.c_int), ('h', C.c_int), ('stride', C.c_int),
                    ('bitmap', C.POINTER(C.c_ubyte)), ('color', C.c_uint32),
                    ('dst_x', C.c_int), ('dst_y', C.c_int),
                    ('next', C.POINTER(AssImage)), ('type', C.c_int)]


class Measure:
    def __init__(self):
        self.lib = C.CDLL(ctypes.util.find_library('ass'))
        signatures = {
            'ass_library_init': ([], C.c_void_p),
            'ass_renderer_init': ([C.c_void_p], C.c_void_p),
            'ass_set_frame_size': ([C.c_void_p, C.c_int, C.c_int], None),
            'ass_set_fonts': ([C.c_void_p, C.c_char_p, C.c_char_p, C.c_int, C.c_char_p, C.c_int], None),
            'ass_read_memory': ([C.c_void_p, C.c_char_p, C.c_size_t, C.c_char_p], C.c_void_p),
            'ass_render_frame': ([C.c_void_p, C.c_void_p, C.c_longlong, C.POINTER(C.c_int)], C.POINTER(AssImage)),
            'ass_free_track': ([C.c_void_p], None),
        }
        for name, (args, result) in signatures.items():
            function = getattr(self.lib, name)
            function.argtypes, function.restype = args, result
        self.library = self.lib.ass_library_init()
        self.renderer = self.lib.ass_renderer_init(self.library)
        if not self.library or not self.renderer:
            raise RuntimeError('libass initialization failed')
        self.lib.ass_set_frame_size(self.renderer, 8192, HEIGHT)
        self.lib.ass_set_fonts(self.renderer, None, b'Arial', 1, None, 1)

    @lru_cache(maxsize=32768)
    def width(self, text):
        data = (header(8192, HEIGHT, 0, 7) +
                'Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,' + escape(text) + '\n').encode()
        track = self.lib.ass_read_memory(self.library, data, len(data), b'UTF-8')
        if not track:
            raise ValueError('ASS measurement failed')
        image = self.lib.ass_render_frame(self.renderer, track, 500, C.byref(C.c_int()))
        right = 0
        while image:
            item = image.contents
            right = max(right, item.dst_x + item.w)
            image = item.next
        self.lib.ass_free_track(track)
        return right


def layout_functions(measure):
    @lru_cache(maxsize=32768)
    def fits(line):
        return len(unicodedata.normalize('NFC', line)) <= LINE_CHARS and measure.width(line) <= WIDTH - 2*MARGIN

    @lru_cache(maxsize=8192)
    def layout(text):
        if fits(text):
            return [text]
        options = []
        for m in re.finditer(' ', text):
            left, right = text[:m.start()], text[m.end():]
            if fits(left) and fits(right):
                orphan = min(len(left.split()), len(right.split())) == 1
                options.append(((orphan, boundary_cost(left), abs(measure.width(left)-measure.width(right))), [left, right]))
        return min(options, key=lambda option: option[0])[1] if options else None

    def fallback(text):
        # Indivisible input exceptions retain every word, same font size. They
        # may need more than two lines: listed separately, never concealed.
        lines, current = [], ''
        for word in text.split():
            joined = (current + ' ' + word).strip()
            if current and not fits(joined):
                lines.append(current)
                current = word
            else:
                current = joined
        if current:
            lines.append(current)
        return lines
    return layout, fallback


def candidate(segments, first, last, layout, fallback):
    selected = segments[first:last+1]
    text = ' '.join(text_of(s) for s in selected)
    start, end = selected[0]['start_ms'], selected[-1]['end_ms']
    duration = end-start
    chars = len(unicodedata.normalize('NFC', text))
    lines = layout(text)
    exceptions = []
    if duration > MAX_MS:
        exceptions.append('input_longer_than_7_seconds')
    if chars * 1000 > MAX_CPS * duration:
        exceptions.append('input_faster_than_21_cps')
    if lines is None:
        exceptions.append('input_does_not_fit_two_lines')
    if last > first and exceptions:
        return None
    return dict(first=first, last=last, start_ms=start, end_ms=end, text=text,
                lines=lines or fallback(text), cps=round(chars*1000/duration, 3),
                exceptions=exceptions)


def timestamp(ms, ass=False):
    h, rest = divmod(ms, 3600000)
    m, rest = divmod(rest, 60000)
    s, rest = divmod(rest, 1000)
    return f'{h}:{m:02}:{s:02}.{rest//10:02}' if ass else f'{h:02}:{m:02}:{s:02},{rest:03}'

