"""Use the actual web export renderer on segment cues, not TTS paragraphs."""
import copy
import json
import math
import subprocess

from workspace import CLIError, ROOT, load_project, source_digest, atomic_write
from tts_export import file_hash, voice_slot


def remap_segments(project, groups, pieces):
    ids = [sid for group in groups for sid in group.ids]
    wanted = set(ids)
    selected = [s for s in project["segments"] if s["id"] in wanted]
    if [s["id"] for s in selected] != ids:
        raise CLIError("Les segments de sous-titres ne correspondent pas au plan TTS.")
    by_id = {s["id"]: s for s in selected}
    for group in groups:
        text = " ".join(" ".join(by_id[sid]["french"].split()) for sid in group.ids)
        if text != group.text:
            raise CLIError("La traduction a changé depuis la génération TTS.")
        if group.start_ms != by_id[group.ids[0]]["start_ms"] or group.end_ms != by_id[group.ids[-1]]["end_ms"]:
            raise CLIError("Les timestamps ont changé depuis le plan TTS.")

    def mapped(ms):
        for piece in pieces:
            a, b = piece["source_start_ms"], piece["source_end_ms"]
            if a <= ms <= b:
                start, end = piece["output_start_ms"], piece["output_end_ms"]
                return round(start + (ms - a) * (end - start) / (b - a))
        raise CLIError("Sous-titre hors du recalage vidéo.")

    result = copy.deepcopy(selected)
    for segment in result:
        segment["start_ms"] = mapped(segment["start_ms"])
        segment["end_ms"] = mapped(segment["end_ms"])
        if segment["end_ms"] <= segment["start_ms"]:
            raise CLIError("Sous-titre trop court après recalage.")
    return result


def voice_timed_segments(segments, groups, mapped_groups, natural_seconds, speech_regions=None):
    """Local proportional timing, reset at every independently generated take."""
    if natural_seconds is None or not len(groups) == len(mapped_groups) == len(natural_seconds):
        raise CLIError("Bornes de doublage incomplètes.")
    if speech_regions and len(speech_regions) != len(groups):
        raise CLIError("Bornes de parole incomplètes.")
    result = copy.deepcopy(segments)
    by_id = {s["id"]: s for s in result}
    anchors = []
    for index, (group, mapped, seconds) in enumerate(zip(groups, mapped_groups, natural_seconds)):
        if not math.isfinite(seconds) or seconds <= 0:
            raise CLIError("Durée de doublage invalide.")
        slot_start, slot_end = voice_slot(mapped)
        start, end = slot_start, min(slot_end, slot_start + round(seconds * 1000))
        if speech_regions and speech_regions[index]:
            # Reuse the existing cheap VAD only for take endpoints, not words.
            start = max(start, slot_start + speech_regions[index][0][0])
            end = min(end, slot_start + speech_regions[index][-1][1])
        rows = [by_id[sid] for sid in group.ids]
        if end - start < len(rows):
            raise CLIError("Intervalle de doublage trop court pour les sous-titres.")
        weights = [max(1, sum(c.isalnum() for c in row["french"])) for row in rows]
        total, consumed, cursor = sum(weights), 0, start
        for offset, (row, weight) in enumerate(zip(rows, weights)):
            consumed += weight
            remaining = len(rows) - offset - 1
            boundary = min(end - remaining, max(cursor + 1, start + round((end - start) * consumed / total)))
            row["start_ms"], row["end_ms"] = cursor, boundary
            cursor = boundary
        anchors.append({"paragraph": index, "start_ms": start, "end_ms": end, "segments": len(rows)})
    return result, anchors


def write_web_subtitles(project_path, project_id, groups, pieces, directory, width, height,
                        *, mapped_groups=None, natural_seconds=None, speech_regions=None, audio_pause_regions=None):
    project = load_project(project_path, translated=True)
    if project["id"] != project_id:
        raise CLIError("Le projet de sous-titres ne correspond pas au projet TTS.")
    segments = remap_segments(project, groups, pieces)
    timing = "source segments mapped to retimed video, not word-aligned to French TTS"
    if mapped_groups is not None:
        segments, anchors = voice_timed_segments(segments, groups, mapped_groups, natural_seconds, speech_regions)
        atomic_write(directory / "subtitle-anchors.json", (json.dumps(anchors, indent=2) + "\n").encode())
        timing = "character-weighted within each French take; hard reset at each take; approximate, not word alignment"
        if audio_pause_regions is not None:
            from subtitle_audio import punctuation_pause_rows
            segments, pause_anchors = punctuation_pause_rows(segments, groups, mapped_groups, audio_pause_regions)
            atomic_write(directory / "subtitle-pause-anchors.json", (json.dumps(pause_anchors, indent=2) + "\n").encode())
            timing += "; local energy/punctuation pause anchors, corrections <=600ms, fallback on invalid anchors"
    binary = ROOT / "web/.cache/local-api"
    if not binary.is_file():
        raise CLIError("Moteur de sous-titres absent : make cli-api-build.")
    try:
        process = subprocess.run([str(binary)], input=json.dumps({"kind": "subtitles", "segments": segments,
                                 "width": width, "height": height}), text=True, capture_output=True, timeout=60)
        response = json.loads(process.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        raise CLIError("Moteur de sous-titres indisponible ; lancer make cli-api-build.") from exc
    if process.returncode or response.get("error"):
        raise CLIError("Échec du rendu web des sous-titres ; vérifier make cli-api-build.")
    for key, filename in (("ass", "subtitles.ass"), ("srt", "subtitles.srt")):
        atomic_write(directory / filename, response["result"][key].encode())
    return {"mode": "web-segments", "project_sha256": source_digest(project), "segments": len(segments),
            "renderer_sha256": file_hash(binary),
            "timing": timing}
