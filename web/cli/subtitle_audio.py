"""Bounded caption refinements from cheap audio energy, without ASR."""
from array import array
import copy
import math
import re
import sys
import wave

from speech_mix import regions
from tts_export import voice_slot
from workspace import CLIError


def energy_regions(path):
    energy = []
    with wave.open(str(path)) as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or wav.getframerate() < 8000:
            raise CLIError("L'analyse des pauses exige un WAV mono PCM16.")
        frames = round(wav.getframerate() * .01)
        while data := wav.readframes(frames):
            samples = array("h", data)
            if sys.byteorder != "little":
                samples.byteswap()
            energy.append(math.sqrt(sum(int(x) ** 2 for x in samples) / len(samples)))
    if not energy:
        return []
    floor = max(3, sorted(energy)[int((len(energy) - 1) * .9)] * .04)
    return regions([e >= floor for e in energy], frame_ms=10, min_speech_ms=60)


def punctuation_pause_rows(rows, groups, mapped, speech):
    """Match nearby punctuation/pauses, then interpolate between local anchors.

All endpoints stay inside their original take and within 600 ms of the linear
    estimate. Crossing, too-short or out-of-bounds results keep it unchanged.
"""
    if not len(groups) == len(mapped) == len(speech):
        raise CLIError("Analyses des pauses incomplètes.")
    maximum_shift_ms = 600
    result = copy.deepcopy(rows)
    by_id = {r["id"]: r for r in result}
    decisions = []
    for index, (group, placement) in enumerate(zip(groups, mapped)):
        selected = [by_id[sid] for sid in group.ids]
        start, end = selected[0]["start_ms"], selected[-1]["end_ms"]
        slot_start, _ = voice_slot(placement)
        offsets, punctuation, consumed = [0], set(), 0
        for row in selected:
            text = row["french"]
            for match in re.finditer(r"[.!?…,;:](?=\s|[»”\"]|$)", text):
                punctuation.add(consumed + sum(c.isalnum() for c in text[:match.end()]))
            consumed += max(1, sum(c.isalnum() for c in text))
            offsets.append(consumed)
        total = consumed
        pauses = [(slot_start + a[1], slot_start + b[0]) for a, b in zip(speech[index], speech[index][1:])
                  if 200 <= b[0] - a[1] <= 1500 and start < slot_start + a[1] < slot_start + b[0] < end]
        proposals = []
        for position in punctuation - {0, total}:
            predicted = start + (end - start) * position / total
            if pauses:
                pause = min(range(len(pauses)), key=lambda i: abs(sum(pauses[i]) / 2 - predicted))
                a, b = pauses[pause]
                if max(abs(a - predicted), abs(b - predicted)) <= maximum_shift_ms:
                    proposals.append((abs((a + b) / 2 - predicted), position, pause))
        chosen, used = [], set()
        for distance, position, pause in sorted(proposals):
            if pause not in used:
                chosen.append((position, *pauses[pause]))
                used.add(pause)
        anchors = [(0, start, start), *sorted(chosen), (total, end, end)]
        if any(b[1] <= a[2] for a, b in zip(anchors, anchors[1:])):
            continue
        def wall(position, *, beginning):
            for offset, a, b in anchors:
                if position == offset:
                    return b if beginning else a
            for left, right in zip(anchors, anchors[1:]):
                if left[0] < position < right[0]:
                    return round(left[2] + (right[1] - left[2]) * (position - left[0]) / (right[0] - left[0]))
            raise CLIError("Position hors des ancres audio.")
        bounds = [(wall(a, beginning=True), wall(b, beginning=False)) for a, b in zip(offsets, offsets[1:])]
        if any(b <= a for a, b in bounds) or any(a[1] > b[0] for a, b in zip(bounds, bounds[1:])):
            continue
        if any(max(abs(a - row["start_ms"]), abs(b - row["end_ms"])) > maximum_shift_ms
               for row, (a, b) in zip(selected, bounds)):
            continue
        for row, (a, b) in zip(selected, bounds):
            row.update(start_ms=a, end_ms=b)
        decisions.append({"paragraph": index, "anchors": chosen})
    return result, decisions
