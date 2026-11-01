"""Keep existing raw TTS natural; retime source picture and background together."""
import argparse
from dataclasses import asdict
from fractions import Fraction
import json
import math
from pathlib import Path
import sys
import wave

from tts_export import (RATE, Paragraph, assemble_voice, atempo, caption_files,
                        file_hash, probe, render_mix, run, voice_slot)
from workspace import CLIError, atomic_write, locked, read_json, write_json


def timeline(groups, natural_seconds, source_ms, fps, *, intro_ends=None):
    if not groups or len(groups) != len(natural_seconds) or not 1 <= fps <= 120:
        raise CLIError("Paragraphes ou cadence invalides.")
    pieces, remapped = [], []
    source_cursor, output_frames = 0, 0
    def append(start, end, seconds, index=None):
        nonlocal output_frames
        if end <= start or not math.isfinite(seconds) or seconds <= 0:
            raise CLIError("Intervalle de recalage invalide.")
        frames = max(1, math.ceil(seconds * fps))
        a, b = round(output_frames / fps * 1000), round((output_frames + frames) / fps * 1000)
        piece = {"source_start_ms": start, "source_end_ms": end, "output_start_ms": a,
                 "output_end_ms": b, "frames": frames, "paragraph": index,
                 "source_speed": (end - start) / 1000 / (frames / fps)}
        pieces.append(piece)
        output_frames += frames
        return a, b
    for index, (group, natural) in enumerate(zip(groups, natural_seconds)):
        if group.start_ms < source_cursor or group.end_ms > source_ms or natural <= 0:
            raise CLIError("Paragraphes source chevauchants ou hors du média.")
        if group.start_ms > source_cursor:
            append(source_cursor, group.start_ms, (group.start_ms - source_cursor) / 1000)
        source_start = group.start_ms
        if intro_ends and index in intro_ends:
            intro_end = intro_ends[index]
            if not source_start < intro_end < group.end_ms:
                raise CLIError("Introduction hors du paragraphe source.")
            append(source_start, intro_end, (intro_end - source_start) / 1000)
            pieces[-1]["kind"] = "speech_intro"
            source_start = intro_end
        # Reserve 350 ms before and at least 200 ms after the unretimed take.
        a, b = append(source_start, group.end_ms, natural + .550, index)
        remapped.append(Paragraph(group.ids, a, b, group.text))
        source_cursor = group.end_ms
    if source_cursor < source_ms:
        append(source_cursor, source_ms, (source_ms - source_cursor) / 1000)
    return pieces, remapped, round(output_frames / fps * 1000)


def render_piece(video, piece, fps_text, directory, index):
    frames = piece["frames"]
    seconds = frames / float(Fraction(fps_text))
    samples = round(seconds * RATE)
    graph = (
        f"[0:v:0]setpts=(PTS-STARTPTS)/{piece['source_speed']:.12g},fps={fps_text},"
        f"tpad=stop_mode=clone:stop_duration=1,trim=end_frame={frames},setpts=N/({fps_text}*TB)[v];"
        f"[0:a:0]asetpts=PTS-STARTPTS,aresample={RATE},{atempo(piece['source_speed'])},"
        f"apad=whole_len={samples},atrim=end_sample={samples},asetpts=PTS-STARTPTS[a]"
    )
    name = f"piece-{index:04d}.mkv"
    run(["ffmpeg", "-nostdin", "-v", "error", "-ss", str(piece["source_start_ms"] / 1000),
         "-t", str((piece["source_end_ms"] - piece["source_start_ms"]) / 1000), "-i", str(video),
         "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "fast",
         "-crf", "18", "-pix_fmt", "yuv420p", "-bf", "0", "-threads", "0", "-c:a", "flac", name], cwd=directory)
    return name


def concatenate_pieces(directory, pieces, fps_text):
    # Matroska's rounded per-file durations can accumulate gaps. Set exact
    # frame-grid durations so picture/background stay on the mapped timeline.
    fps = float(Fraction(fps_text))
    listing = "".join(f"file 'piece-{i:04d}.mkv'\nduration {piece['frames'] / fps:.12f}\n"
                      for i, piece in enumerate(pieces))
    atomic_write(directory / "pieces.txt", listing.encode())
    run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "1", "-i", "pieces.txt",
         "-c", "copy", "retimed-source.partial.mkv"], cwd=directory)
    (directory / "retimed-source.partial.mkv").replace(directory / "retimed-source.mkv")


def limit_source(groups, source_ms, seconds):
    if seconds is None:
        return groups, source_ms
    if not math.isfinite(seconds) or seconds <= 0:
        raise CLIError("La durée source doit être positive et finie.")
    if seconds * 1000 >= source_ms:
        return groups, source_ms
    if not groups:
        raise CLIError("Aucun paragraphe à exporter.")
    selected = []
    for group in groups:
        selected.append(group)
        if group.end_ms >= seconds * 1000:
            break
    return selected, min(source_ms, selected[-1].end_ms)


def retime(source, output, *, seconds=None, speech_intro=False, bed_db=None, subtitle_project=None,
           subtitle_timing="video", lean=False):
    source, output = source.resolve(), output.resolve()
    if output.exists():
        raise CLIError("La sortie existe déjà : choisir un nouveau dossier.")
    if subtitle_timing not in ("video", "voice", "audio") or (subtitle_timing != "video" and subtitle_project is None):
        raise CLIError("Le calage voix nécessite --subtitle-project.")
    raw_complete = source / "raw-complete.json"
    if not (source / "result.json").is_file() and not raw_complete.is_file():
        raise CLIError("Un export TTS ou une génération brute terminée est requis.")
    if raw_complete.is_file() and read_json(raw_complete).get("plan_sha256") != file_hash(source / "plan.json"):
        raise CLIError("Le plan de génération brute a changé.")
    plan = read_json(source / "plan.json")
    bed_db = (-28 if speech_intro else plan["bed_db"]) if bed_db is None else bed_db
    if not math.isfinite(bed_db) or not -60 <= bed_db <= 0:
        raise CLIError("Le niveau original doit être entre -60 et 0 dB.")
    video = Path(plan["video"])
    if file_hash(video) != plan["video_sha256"]:
        raise CLIError("La vidéo source a changé.")
    groups = [Paragraph(**p) for p in plan["paragraphs"]]
    media = probe(video)
    groups, source_ms = limit_source(groups, media["duration_ms"], seconds)
    natural, raw_hashes = [], []
    for index in range(len(groups)):
        raw = source / f"{index:04d}-raw.wav"
        digest = file_hash(raw)
        if read_json(source / f"{index:04d}.json")["raw_sha256"] != digest:
            raise CLIError("Une prise brute a changé.")
        with wave.open(str(raw), "rb") as handle:
            natural.append(handle.getnframes() / handle.getframerate())
        raw_hashes.append(digest)
    if raw_complete.is_file() and read_json(raw_complete).get("raw_sha256", [])[:len(groups)] != raw_hashes:
        raise CLIError("Le manifeste des prises brutes ne correspond pas aux audios.")
    streams = json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                              "stream=avg_frame_rate", "-of", "json", str(video)]))["streams"]
    fps = Fraction(streams[0]["avg_frame_rate"])
    output.mkdir(parents=True)
    with locked(output):
        intro_ends, cues, source_regions, french_regions = None, [], [], []
        if speech_intro:
            from speech_mix import detect_speech, introductions, duck_windows
            analysis = output / "analysis"
            analysis.mkdir()
            print("Détection de la parole originale et française pour le mixage documentaire…", flush=True)
            source_regions = detect_speech(video, analysis / "source.wav", seconds=source_ms / 1000)
            intro_ends, cues = introductions(groups, source_regions)
            for index in range(len(groups)):
                french_regions.append(detect_speech(source / f"{index:04d}-raw.wav", analysis / f"french-{index:04d}.wav"))
        pieces, mapped, duration = timeline(groups, natural, source_ms, float(fps), intro_ends=intro_ends)
        windows = duck_windows(mapped, french_regions) if speech_intro else None
        write_json(output / "timing.json", {"format": "tarjama-natural-voice-retime-v1", "source_export": str(source),
                   "source_plan_sha256": file_hash(source / "plan.json"), "video_sha256": plan["video_sha256"],
                   "raw_sha256": raw_hashes, "french_speed": 1, "fps": str(fps), "duration_ms": duration,
                   "requested_source_seconds": seconds, "source_end_ms": source_ms,
                   "pieces": pieces, "paragraphs": [asdict(p) for p in mapped],
                   "speech_intro": speech_intro, "bed_db": bed_db, "subtitle_timing": subtitle_timing, "lean": lean})
        if speech_intro:
            write_json(output / "speech-mix.json", {"method": "webrtcvad-mode2-energy-floor-minus50dBFS",
                       "frame_ms": 30, "minimum_speech_ms": 240, "listen_voiced_ms": 1500,
                       "restart_silence_ms": 3000, "duck_hold_gap_ms": 3000, "bed_db": bed_db,
                       "source_speech_regions": source_regions, "french_speech_regions": french_regions,
                       "introductions": cues, "duck_windows_ms": windows, "attack_ms": 350, "release_ms": 1000})
        if subtitle_project is None:
            caption_files(mapped, output, media["width"], media["height"])
        else:
            from web_subtitles import write_web_subtitles
            alignment = ({"mapped_groups": mapped, "natural_seconds": natural,
                          "speech_regions": french_regions} if subtitle_timing != "video" else {})
            if subtitle_timing == "audio":
                from subtitle_audio import energy_regions
                alignment["audio_pause_regions"] = [energy_regions(source / f"{i:04d}-raw.wav") for i in range(len(groups))]
            subtitles = write_web_subtitles(subtitle_project, plan["project_id"], groups, pieces, output,
                                            media["width"], media["height"], **alignment)
            write_json(output / "subtitle-source.json", subtitles)
        for index, group in enumerate(mapped):
            start, end = voice_slot(group)
            samples = round(end * RATE / 1000) - round(start * RATE / 1000)
            # Level/resample/pad only: never stretch or trim away spoken French.
            if samples < round(natural[index] * RATE):
                raise CLIError("Intervalle trop court pour conserver la voix naturelle.")
            run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(source / f"{index:04d}-raw.wav"), "-af",
                 f"loudnorm=I=-20:TP=-3:LRA=7,aresample={RATE},apad=whole_len={samples},atrim=end_sample={samples}",
                 "-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le", str(output / f"{index:04d}-fitted.wav")])
        assemble_voice(mapped, output, duration, output / "voice.wav")
        if lean:
            # This output directory was just created by us. Only exact generated
            # filenames are removed; raw takes and source projects are untouched.
            for index in range(len(mapped)):
                (output / f"{index:04d}-fitted.wav").unlink()
        for index, piece in enumerate(pieces):
            print(f"Recalage image + original {index + 1}/{len(pieces)} : {piece['source_speed']:.3f}×", flush=True)
            render_piece(video, piece, str(fps), output, index)
        concatenate_pieces(output, pieces, str(fps))
        if lean:
            if abs(probe(output / "retimed-source.mkv")["duration_ms"] - duration) > 250:
                raise CLIError("Durée du master recalé incohérente ; intermédiaires conservés.")
            for index in range(len(pieces)):
                (output / f"piece-{index:04d}.mkv").unlink()
        render_mix(output / "retimed-source.mkv", output, mapped, bed_db, copy_video=True,
                   **({"duck_windows": windows} if speech_intro else {}))
        write_json(output / "result.json", {"output": str(output / "export.mkv"),
                   "output_sha256": file_hash(output / "export.mkv"), "french_speed": 1,
                   "duration_ms": duration, "media": probe(output / "export.mkv")})
        if lean:
            (output / "mix.wav").unlink()
    return output / "export.mkv"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", dest="source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=float, help="Durée source cible ; termine le paragraphe en cours sans couper le TTS")
    parser.add_argument("--speech-intro", action="store_true", help="Introduction après parole détectée, original plus discret et sans pompage")
    parser.add_argument("--original-db", type=float, help="Atténuation de l'original ; défaut -28 en mode documentaire")
    parser.add_argument("--subtitle-project", type=Path, help="Sous-titres courts du projet, avec le rendu exact de l'app web")
    parser.add_argument("--subtitle-timing", choices=["video", "voice", "audio"], default="video",
                        help="voice : répartition par prise ; audio : ajoute des ancres sur les pauses, corrections <=600 ms")
    parser.add_argument("--lean", action="store_true", help="Retire les seuls gros intermédiaires de ce nouveau rendu après validation")
    args = parser.parse_args()
    print(retime(args.source, args.output, seconds=args.seconds, speech_intro=args.speech_intro,
                 bed_db=args.original_db, subtitle_project=args.subtitle_project,
                 subtitle_timing=args.subtitle_timing, lean=args.lean))


if __name__ == "__main__":
    try:
        main()
    except (CLIError, OSError, ValueError, KeyError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1)
