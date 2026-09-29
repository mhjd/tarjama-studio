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


def partition(segments, layout, fallback):
    # Global shortest path on segment boundaries, with lexicographic criteria.
    # No fitted weights: first avoid unavoidable input exceptions, then dangling
    # boundaries, unfinished boundaries, >17 cps groups, internal sentence ends,
    # cue count and finally accumulated internal gaps. These priorities are an
    # engineering proposal, NOT a published optimum for conference subtitles.
    n = len(segments)
    best, choice = [None]*(n+1), [None]*n
    best[n] = (0,)*7
    for i in range(n-1, -1, -1):
        text = ''
        for j in range(i, n):
            if j > i and segments[j]['end_ms']-segments[i]['start_ms'] > MAX_MS:
                break
            text = (text + ' ' + text_of(segments[j])).strip()
            if j > i and len(unicodedata.normalize('NFC', text)) > 85:
                break
            c = candidate(segments, i, j, layout, fallback)
            if c is None:
                continue  # A later whole group can have a lower reading speed.
            boundary = boundary_cost(c['text']) if j < n-1 else 0
            internal = sum(boundary_cost(text_of(segments[k])) == 0 for k in range(i, j))
            gaps = sum(segments[k+1]['start_ms']-segments[k]['end_ms'] for k in range(i,j))
            score = (len(c['exceptions']), int(boundary == 3), int(boundary >= 2),
                     int(c['cps'] > PREFERRED_CPS), internal, 1, gaps)
            total = tuple(a+b for a,b in zip(score, best[j+1]))
            if best[i] is None or total < best[i]:
                best[i], choice[i] = total, c
    groups, i = [], 0
    while i < n:
        group = choice[i]
        assert group is not None
        groups.append(group)
        i = group['last']+1
    return groups


def timestamp(ms, ass=False):
    h, rest = divmod(ms, 3600000)
    m, rest = divmod(rest, 60000)
    s, rest = divmod(rest, 1000)
    return f'{h}:{m:02}:{s:02}.{rest//10:02}' if ass else f'{h:02}:{m:02}:{s:02},{rest:03}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.input.read_text())
    segments = data['segments']
    for i, s in enumerate(segments):
        assert s['end_ms'] > s['start_ms'] >= 0 and text_of(s)
        if i:
            assert s['start_ms'] >= segments[i-1]['end_ms'], 'Overlapping source segments need separate handling'
    measure = Measure()
    layout, fallback = layout_functions(measure)
    groups = partition(segments, layout, fallback)
    assert ' '.join(g['text'] for g in groups) == ' '.join(text_of(s) for s in segments)
    for g in groups:
        assert ' '.join(g['lines']) == g['text']
        assert g['start_ms'] == segments[g['first']]['start_ms']
        assert g['end_ms'] == segments[g['last']]['end_ms']
        if g['last'] > g['first']:
            assert not g['exceptions'] and len(g['lines']) <= 2
    args.output.mkdir(parents=True, exist_ok=True)
    ass = header()
    srt = ''
    for number, g in enumerate(groups, 1):
        # Preserve production's automatic wrapping for already oversized input
        # exceptions. The proposed two-line breaks apply to admissible cues;
        # never turn an existing three-line source cue into five forced lines.
        body = escape(g['text']) if g['exceptions'] else '\\N'.join(escape(line) for line in g['lines'])
        ass += f"Dialogue: 0,{timestamp(g['start_ms'],True)},{timestamp(g['end_ms'],True)},Default,,0,0,0,,{body}\n"
        srt += f"{number}\n{timestamp(g['start_ms'])} --> {timestamp(g['end_ms'])}\n" + '\n'.join(g['lines']) + '\n\n'
    (args.output/'subtitles.ass').write_text(ass)
    (args.output/'sirat-episode-4-regroupement-progressif.srt').write_text(srt)
    summary = dict(project_id=data['project_id'], project_version=data['project_version'],
                   input_sha256=hashlib.sha256(args.input.read_bytes()).hexdigest(),
                   input_segments=len(segments), output_cues=len(groups),
                   merged_groups=sum(g['last']>g['first'] for g in groups),
                   max_segments_per_group=max(g['last']-g['first']+1 for g in groups),
                   groups_faster_than_17=sum(g['cps']>17 for g in groups),
                   unchanged_input_exceptions=sum(bool(g['exceptions']) for g in groups),
                   text_preserved=True, application_changed=False, font_size=SIZE,
                   examples=[g for g in groups if 1448000 <= g['start_ms'] < 1455800 or 2770000 <= g['start_ms'] < 2785000])
    (args.output/'partition.json').write_text(json.dumps(groups, ensure_ascii=False, indent=2)+'\n')
    (args.output/'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
