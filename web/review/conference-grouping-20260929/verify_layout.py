"""Check actual libass bitmap bounds for every cue in this offline trial."""
import ctypes as C
import json
from pathlib import Path
from prepare import Measure, WIDTH, HEIGHT, MARGIN, SIZE

p = Path('/output')
m = Measure()
m.lib.ass_set_frame_size(m.renderer, WIDTH, HEIGHT)
data = (p/'subtitles.ass').read_bytes()
track = m.lib.ass_read_memory(m.library, data, len(data), b'UTF-8')
assert track
groups = json.loads((p/'partition.json').read_text())
results = []
for g in groups:
    moment = (g['start_ms']+g['end_ms'])//2
    image = m.lib.ass_render_frame(m.renderer, track, moment, C.byref(C.c_int()))
    bounds = []
    while image:
        x = image.contents
        if x.w and x.h:
            bounds.append((x.dst_x, x.dst_y, x.dst_x+x.w, x.dst_y+x.h))
        image = x.next
    assert bounds, g['first']
    left, top = min(b[0] for b in bounds), min(b[1] for b in bounds)
    right, bottom = max(b[2] for b in bounds), max(b[3] for b in bounds)
    # Bitmap rectangles include transparent raster padding, unlike text's
    # typographic margins. Check the actual video boundary here; the layout
    # planner separately measures the available line width.
    assert left >= 0 and right <= WIDTH, (g['first'], bounds)
    assert top >= 0 and bottom <= HEIGHT, (g['first'], bounds)
    # libass background boxes include padding beyond nominal line height.
    # Cluster tops of background/glyph runs into vertically separated bands,
    # rather than treating font size as the exact bitmap height.
    bands = []
    for y in sorted(b[1] for b in bounds):
        if not bands or y-bands[-1] > SIZE/2:
            bands.append(y)
    if g['last'] > g['first']:
        assert len(bands) <= 2, (g['first'], bounds, bands)
    results.append(dict(first=g['first'], last=g['last'], bounds=[left,top,right,bottom], line_bands=len(bands)))
m.lib.ass_free_track(track)
(p/'layout-check.json').write_text(json.dumps(dict(checked_cues=len(results),
    all_inside_video=True, all_merged_groups_at_most_two_line_bands=True,
    results=results),indent=2)+'\n')
print('PASS:',len(results),'cue bounds, including all merged groups')
