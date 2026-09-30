"""Bounded stdin/stdout adapter for the frozen S1 partition. No external I/O."""
import json
import resource
import sys

resource.setrlimit(resource.RLIMIT_AS, (256 * 1024**2, 256 * 1024**2))
resource.setrlimit(resource.RLIMIT_CPU, (20, 21))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

import layout
from candidate import partition


def main():
    data = json.load(sys.stdin)
    source = data['segments']
    if not source or len(source) > 50000:
        raise ValueError('Invalid segment count')
    # Keep the qualified 1080p landscape geometry; narrower aspect ratios
    # constrain grouping to their actual available width at the same font size.
    width, height = data['width'], data['height']
    if not (2 <= width <= 8192 and 2 <= height <= 8192):
        raise ValueError('Invalid geometry')
    layout.WIDTH = round(width * 1080 / min(width, height))
    layout.MARGIN = max(20, round(layout.WIDTH * .05))
    for index, segment in enumerate(source):
        if not (0 <= segment['start_ms'] < segment['end_ms'] <= 10800000):
            raise ValueError('Invalid timing')
        if index and segment['start_ms'] < source[index-1]['end_ms']:
            raise ValueError('Overlapping segments')
    measure = layout.Measure()
    fit, fallback = layout.layout_functions(measure)
    groups = partition(source, fit, fallback)
    json.dump(groups, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
