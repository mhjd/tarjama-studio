"""Compare cheap speech-clock caption timing with the saved STT audit.

No API call, TTS regeneration or change to an existing export.
"""
import argparse
from array import array
import copy
import json
import math
from pathlib import Path
import re
import statistics
import sys
import wave

from audit_subtitle_timing import compare, read_srt
from speech_mix import regions
from subtitle_audio import energy_regions as raw_energy_regions, punctuation_pause_rows as bounded_audio_rows
from tts_export import Paragraph, voice_slot
from web_subtitles import remap_segments, voice_timed_segments, write_web_subtitles
from workspace import CLIError, load_project, read_json, write_json
from tts_export import file_hash


def energy_regions(path):
    """10 ms RMS windows; relative floor, no model or language dependency."""
    energy = []
    with wave.open(str(path)) as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 16000):
            raise CLIError("Analyse audio attendue en mono PCM16 16 kHz.")
        while data := wav.readframes(160):
            samples = array("h", data)
            if sys.byteorder != "little":
                samples.byteswap()
            energy.append(math.sqrt(sum(int(x) ** 2 for x in samples) / len(samples)))
    if not energy:
        return []
    # A fixed relative floor, not calibrated against recognized words.
    floor = max(3, sorted(energy)[int((len(energy) - 1) * .9)] * .04)
    return regions([e >= floor for e in energy], frame_ms=10, min_speech_ms=60)


def speech_clock_rows(rows, groups, mapped, natural, speech):
    """Allocate text only over voiced time, then map back across real pauses."""
    result = copy.deepcopy(rows)
    by_id = {r["id"]: r for r in result}
    anchors = []
    for index, (group, placement, seconds) in enumerate(zip(groups, mapped, natural)):
        slot_start, slot_end = voice_slot(placement)
        end = min(slot_end, slot_start + round(seconds * 1000))
        spans = [(max(slot_start, slot_start + a), min(end, slot_start + b)) for a, b in speech[index]]
        spans = [(a, b) for a, b in spans if b > a]
        if not spans:
            continue  # Keep the old bounded estimate when audio has no usable speech.
        selected = [by_id[sid] for sid in group.ids]
        total = sum(b - a for a, b in spans)
        weights = [max(1, sum(c.isalnum() for c in r["french"])) for r in selected]
        def wall_time(position):
            for a, b in spans:
                if position <= b - a:
                    return round(a + position)
                position -= b - a
            return spans[-1][1]
        boundaries, consumed = [spans[0][0]], 0
        for weight in weights[:-1]:
            consumed += weight
            boundaries.append(wall_time(total * consumed / sum(weights)))
        boundaries.append(spans[-1][1])
        if any(b <= a for a, b in zip(boundaries, boundaries[1:])):
            continue
        for row, a, b in zip(selected, boundaries, boundaries[1:]):
            row.update(start_ms=a, end_ms=b)
        anchors.append({"paragraph": index, "start_ms": boundaries[0], "end_ms": boundaries[-1]})
    return result, anchors


def pause_anchored_rows(rows, groups, mapped, speech, *, clauses=False, maximum_shift_ms=1200,
                        minimum_pause_ms=160, uniqueness_margin_ms=0):
    """Anchor sentence ends to nearby real pauses; interpolate only in between."""
    result = copy.deepcopy(rows)
    by_id = {r["id"]: r for r in result}
    decisions = []
    for index, (group, placement) in enumerate(zip(groups, mapped)):
        selected = [by_id[sid] for sid in group.ids]
        slot_start, _ = voice_slot(placement)
        start, end = selected[0]["start_ms"], selected[-1]["end_ms"]
        pauses = [(slot_start + a[1], slot_start + b[0]) for a, b in zip(speech[index], speech[index][1:])
                  if b[0] - a[1] >= minimum_pause_ms and start < slot_start + a[1] < slot_start + b[0] < end]
        proposals = []
        for boundary, row in enumerate(selected[:-1], 1):
            punctuation = re.sub(r'[»”"\s]+$', '', row["french"])[-1:]
            if punctuation not in (".!?…;,：:" if clauses else ".!?…"):
                continue
            predicted = row["end_ms"]
            if pauses:
                nearest = sorted(range(len(pauses)), key=lambda i: abs(sum(pauses[i]) / 2 - predicted))
                pause = nearest[0]
                distance = abs(sum(pauses[pause]) / 2 - predicted)
                if len(nearest) > 1 and abs(sum(pauses[nearest[1]]) / 2 - predicted) - distance < uniqueness_margin_ms:
                    continue
                if distance <= maximum_shift_ms:
                    proposals.append((distance, boundary, pause))
        chosen, used = [], set()
        for distance, boundary, pause in sorted(proposals):
            if pause not in used:
                chosen.append((boundary, *pauses[pause]))
                used.add(pause)
        anchors = [(0, start, start), *sorted(chosen), (len(selected), end, end)]
        if any(b[1] - a[2] < b[0] - a[0] for a, b in zip(anchors, anchors[1:])):
            continue  # Ambiguous/crossing/too short: keep the existing bounded estimate.
        for left, right in zip(anchors, anchors[1:]):
            subset = selected[left[0]:right[0]]
            weights = [max(1, sum(c.isalnum() for c in row["french"])) for row in subset]
            span, cursor, consumed = right[1] - left[2], left[2], 0
            for offset, (row, weight) in enumerate(zip(subset, weights)):
                consumed += weight
                remaining = len(subset) - offset - 1
                boundary = min(right[1] - remaining, max(cursor + 1, left[2] + round(span * consumed / sum(weights))))
                row.update(start_ms=cursor, end_ms=boundary)
                cursor = boundary
        decisions.append({"paragraph": index, "internal_pause_anchors": len(chosen)})
    return result, decisions


def punctuation_pause_rows(rows, groups, mapped, speech, *, maximum_shift_ms=900):
    """Use punctuation inside cues too, with bounded monotone audio anchors."""
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
                position = consumed + sum(c.isalnum() for c in text[:match.end()])
                punctuation.add(position)
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
        for row, (a, b) in zip(selected, bounds):
            row.update(start_ms=a, end_ms=b)
        decisions.append({"paragraph": index, "internal_pause_anchors": len(chosen)})
    return result, decisions


def rhythm_rows(rows, groups, mapped, export):
    """A diagnostic syllabic-energy clock, no recognizer or learned alignment."""
    result = copy.deepcopy(rows)
    by_id = {r["id"]: r for r in result}
    for index, (group, placement) in enumerate(zip(groups, mapped)):
        if placement.start_ms >= 600000:
            break
        selected = [by_id[sid] for sid in group.ids]
        energy = []
        with wave.open(str(export / "analysis" / f"french-{index:04d}.wav")) as wav:
            while data := wav.readframes(160):
                values = array("h", data)
                if sys.byteorder != "little":
                    values.byteswap()
                energy.append(math.sqrt(sum(int(x) ** 2 for x in values) / len(values)))
        smooth = [statistics.mean(energy[max(0, i - 2):i + 3]) for i in range(len(energy))]
        floor = sorted(smooth)[int((len(smooth) - 1) * .9)] * .15
        peaks = [i for i in range(6, len(smooth) - 6)
                 if smooth[i] >= floor and smooth[i] == max(smooth[i - 6:i + 7])]
        accepted = []
        for i in sorted(peaks, key=lambda i: smooth[i], reverse=True):
            if all(abs(i - j) >= 15 for j in accepted):
                accepted.append(i)
        slot_start, _ = voice_slot(placement)
        start, end = selected[0]["start_ms"], selected[-1]["end_ms"]
        clock = sorted(slot_start + i * 10 for i in accepted if start < slot_start + i * 10 < end)
        if len(clock) < len(selected):
            continue
        weights = [max(1, len(re.findall(r"[aeiouyàâäéèêëîïôöùûüœ]+", r["french"].casefold()))) for r in selected]
        points, consumed = [start], 0
        for weight in weights[:-1]:
            consumed += weight
            position = (len(clock) - 1) * consumed / sum(weights)
            a, b = math.floor(position), math.ceil(position)
            points.append(round(clock[a] + (clock[b] - clock[a]) * (position - a)))
        points.append(end)
        if any(b <= a for a, b in zip(points, points[1:])):
            continue
        for row, a, b in zip(selected, points, points[1:]):
            row.update(start_ms=a, end_ms=b)
    return result


def experiment(export, project, audit, output):
    output.mkdir(parents=True, exist_ok=False)
    timing = read_json(export / "timing.json")
    raw = Path(timing["source_export"])
    plan = read_json(raw / "plan.json")
    words = read_json(audit / "groq-response.json")["words"]
    groups = [Paragraph(**p) for p in plan["paragraphs"]]
    mapped = [Paragraph(**p) for p in timing["paragraphs"]]
    baseline = remap_segments(load_project(project, translated=True), groups, timing["pieces"])
    natural = []
    for i in range(len(groups)):
        with wave.open(str(raw / f"{i:04d}-raw.wav")) as wav:
            natural.append(wav.getnframes() / wav.getframerate())
    vad = read_json(export / "speech-mix.json")["french_speech_regions"]
    linear, _ = voice_timed_segments(baseline, groups, mapped, natural, vad)
    # Only analyze paragraphs intersecting the first 600 output seconds.
    energy = [raw_energy_regions(raw / f"{i:04d}-raw.wav")
              if p.start_ms < 600000 else vad[i] for i, p in enumerate(mapped)]
    variants = {"linear": linear, "vad_clock": speech_clock_rows(linear, groups, mapped, natural, vad)[0],
                "energy_clock": speech_clock_rows(linear, groups, mapped, natural, energy)[0],
                "sentence_pauses": pause_anchored_rows(linear, groups, mapped, energy)[0],
                "clause_pauses": pause_anchored_rows(linear, groups, mapped, energy, clauses=True, maximum_shift_ms=900)[0],
                "clear_sentence_pauses": pause_anchored_rows(linear, groups, mapped, energy,
                    maximum_shift_ms=900, minimum_pause_ms=300, uniqueness_margin_ms=180)[0],
                "small_sentence_pauses": pause_anchored_rows(linear, groups, mapped, energy,
                    maximum_shift_ms=600, minimum_pause_ms=300, uniqueness_margin_ms=180)[0],
                "punctuation_pauses": punctuation_pause_rows(linear, groups, mapped, energy)[0],
                "bounded_punctuation_pauses": bounded_audio_rows(linear, groups, mapped, energy)[0],
                "syllabic_energy_rhythm": rhythm_rows(linear, groups, mapped, export)}
    reports = {}
    for name, rows in variants.items():
        train = compare([r for r in rows if r["end_ms"] <= 300000], words, 300)
        reports[name] = {"first_5min": train}
        write_json(output / f"{name}-segments.json", rows)
    # Rank on the first five minutes, then diagnose the second five. Repeated
    # local experiments are not an independent/generalization benchmark.
    def score(name):
        summary = reports[name]["first_5min"]["summary"]
        return summary["boundary_abs_median_ms"] + .5 * summary["boundary_abs_p90_ms"]
    base = reports["linear"]["first_5min"]["summary"]
    safe = [name for name, report in reports.items()
            if report["first_5min"]["summary"]["boundary_abs_p95_ms"] <= base["boundary_abs_p95_ms"]
            and report["first_5min"]["summary"]["boundary_abs_max_ms"] <= base["boundary_abs_max_ms"]
            and report["first_5min"]["summary"]["boundaries_over_2s"] <= base["boundaries_over_2s"]]
    winner = min(safe, key=score)
    for name in ("linear", winner):
        rows = variants[name]
        reports[name]["second_5min"] = compare([r for r in rows if r["start_ms"] >= 300000], words, 600)
        reports[name]["all_10min"] = compare(rows, words, 600)
    result = {"selection": "first 5min median + 0.5*p90, with non-worsening training p95/max/>2s; second 5min inspected afterwards",
              "winner": winner, "variants": reports, "source_timing_sha256": file_hash(export / "timing.json"),
              "stt_response_sha256": file_hash(audit / "groq-response.json")}
    if winner == "bounded_punctuation_pauses":
        count = sum(g.start_ms < 600000 for g in mapped)
        result["subtitle_source"] = write_web_subtitles(project, plan["project_id"], groups[:count], timing["pieces"], output,
            plan["media"]["width"], plan["media"]["height"], mapped_groups=mapped[:count], natural_seconds=natural[:count],
            speech_regions=vad[:count], audio_pause_regions=energy[:count])
        result["rendered_srt"] = compare(read_srt(output / "subtitles.srt"), words, 600)
    write_json(output / "report.json", result)
    print(json.dumps({"winner": winner, "first_5min": {k: v["first_5min"]["summary"] for k, v in reports.items()},
                      "validation_second_5min": {k: v["second_5min"]["summary"] for k, v in reports.items() if "second_5min" in v}}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("export", "project", "audit", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    try:
        experiment(args.export, args.project, args.audit, args.output)
    except (CLIError, OSError, ValueError, KeyError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1)
