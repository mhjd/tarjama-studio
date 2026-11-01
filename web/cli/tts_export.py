"""Sentence-boundary paragraphs, local speech fitting, and documentary voice-over."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import wave

from workspace import CLIError, locked, source_digest, timecode, write_json

RATE = 48000
ABBREVIATION = re.compile(r"\b(?:M|Mme|Mlle|Dr|Pr|St|Ste|etc|cf|ex|av|apr|p|pp)\.$", re.I)


@dataclass
class Paragraph:
    ids: list[str]
    start_ms: int
    end_ms: int
    text: str


def sentence_end(text: str) -> bool:
    value = text.strip()
    # References after a closing quotation belong to the same spoken sentence.
    value = re.sub(r"\s*\([^()]*\)\s*$", "", value)
    value = value.rstrip(' \"\'»”’)]}')
    return (bool(re.search(r"[.!?؟]$", value)) and not value.endswith("...")
            and not ABBREVIATION.search(value) and not re.search(r"(?:\b[A-Z]\.){2,}$", value))


def paragraphs(segments: list[dict], target_ms=60000, target_chars=700) -> list[Paragraph]:
    if target_ms <= 0 or target_chars <= 0:
        raise CLIError("La taille cible des paragraphes doit être positive")
    # First collect complete sentences; never split a subtitle or cut at a comma.
    sentences, pending = [], []
    for segment in segments:
        if not segment.get("french", "").strip():
            raise CLIError(f"Traduction absente : {segment['id']}")
        pending.append(segment)
        if sentence_end(segment["french"]):
            sentences.append(pending)
            pending = []
    if pending:
        # Keep the final incomplete sentence, rather than silently omitting it.
        sentences.append(pending)
    result, group = [], []

    def emit():
        nonlocal group
        if group:
            text = " ".join(" ".join(s["french"].split()) for s in group)
            if len(text) > 4000:
                raise CLIError("Une phrase dépasse 4000 caractères sans frontière sûre. Corrigez sa ponctuation avant le TTS.")
            result.append(Paragraph([s["id"] for s in group], group[0]["start_ms"], group[-1]["end_ms"], text))
            group = []

    for sentence in sentences:
        # A long pause between sentences should remain audible in the original.
        if group and sentence[0]["start_ms"] - group[-1]["end_ms"] >= 1500:
            emit()
        prospective_ms = sentence[-1]["end_ms"] - (group[0]["start_ms"] if group else sentence[0]["start_ms"])
        prospective_chars = sum(len(s["french"]) + 1 for s in group + sentence)
        if group and (prospective_ms > target_ms or prospective_chars > target_chars):
            emit()
        group.extend(sentence)
        if group[-1]["end_ms"] - group[0]["start_ms"] >= target_ms or sum(len(s["french"]) + 1 for s in group) >= target_chars:
            emit()
    emit()
    return result


def voice_slot(p: Paragraph) -> tuple[int, int]:
    duration = p.end_ms - p.start_ms
    lead, tail = min(350, duration // 10), min(200, duration // 10)
    return p.start_ms + lead, p.end_ms - tail


def run(command: list[str], *, cwd: Path | None = None, timeout=14400) -> str:
    if command[0] in ("ffmpeg", "ffprobe"):
        import os
        executable = command[0]
        configured = os.environ.get("TARJAMA_" + executable.upper())
        full = Path("/opt/homebrew/opt/ffmpeg-full/bin") / executable
        # Homebrew's minimal ffmpeg may omit libass; prefer the full build.
        selected = configured or (str(full) if full.is_file() else executable)
        command = [selected, *command[1:]]
    try:
        result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CLIError(f"Outil indisponible ou délai dépassé : {command[0]}") from exc
    if result.returncode:
        raise CLIError(f"{Path(command[0]).name} a échoué : {result.stderr[-2400:]}")
    return result.stdout


def probe(path: Path) -> dict:
    data = json.loads(run([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path.resolve()),
    ], timeout=60))
    video = next((s for s in data["streams"] if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    if not video or not audio:
        raise CLIError("Le fichier doit contenir une vraie piste vidéo et une piste audio")
    duration = float(data["format"].get("duration", 0))
    if not math.isfinite(duration) or duration <= 0:
        raise CLIError("Durée du média invalide")
    width, height = int(video["width"]), int(video["height"])
    rotation = next((s.get("rotation", 0) for s in video.get("side_data_list", []) if "rotation" in s), 0)
    if round(float(rotation)) % 180:
        width, height = height, width
    return {"duration_ms": round(duration * 1000), "width": width, "height": height}


def atempo(rate: float) -> str:
    if not math.isfinite(rate) or rate <= 0:
        raise CLIError("Vitesse audio invalide")
    factors = []
    while rate > 2:
        factors.append(2.0)
        rate /= 2
    while rate < 0.5:
        factors.append(0.5)
        rate /= 0.5
    factors.append(rate)
    return ",".join(f"atempo={factor:.12g}" for factor in factors)


def fit_voice(raw: Path, target: Path, duration_ms: int) -> dict:
    with wave.open(str(raw), "rb") as audio:
        natural = audio.getnframes() / audio.getframerate()
    if natural <= 0 or duration_ms <= 0:
        raise CLIError("Prise vocale vide ou intervalle nul")
    speed = natural / (duration_ms / 1000)
    if speed < 0.65 or speed > 1.6:
        print(f"Attention : vitesse {speed:.2f}× sur {target.name} ; écoutez ce paragraphe.", file=sys.stderr)
    samples = round(duration_ms * RATE / 1000)
    # One constant pitch-preserving speed per paragraph, then sample-exact padding.
    filters = (f"{atempo(speed)},loudnorm=I=-20:TP=-3:LRA=7,aresample={RATE},"
               f"apad=whole_len={samples},atrim=end_sample={samples},asetpts=PTS-STARTPTS")
    run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(raw), "-af", filters,
         "-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le", str(target)])
    return {"natural_seconds": natural, "target_ms": duration_ms, "speed": speed}


def silence(handle, frames: int) -> None:
    if frames < 0:
        raise CLIError("La piste vocale dépasse la durée de la vidéo")
    while frames:
        count = min(frames, RATE * 10)
        handle.writeframesraw(b"\0\0" * count)
        frames -= count


def assemble_voice(groups: list[Paragraph], directory: Path, duration_ms: int, output: Path) -> None:
    with wave.open(str(output), "wb") as target:
        target.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        cursor = 0
        for index, paragraph in enumerate(groups):
            start, end = voice_slot(paragraph)
            start_frame, end_frame = round(start * RATE / 1000), round(end * RATE / 1000)
            if start_frame < cursor:
                raise CLIError("Paragraphes audio qui se chevauchent")
            silence(target, start_frame - cursor)
            with wave.open(str(directory / f"{index:04d}-fitted.wav"), "rb") as chunk:
                if (chunk.getnchannels(), chunk.getsampwidth(), chunk.getframerate(), chunk.getnframes()) != (1, 2, RATE, end_frame - start_frame):
                    raise CLIError("Morceau audio non aligné à l'échantillon")
                while data := chunk.readframes(RATE * 10):
                    target.writeframesraw(data)
            cursor = end_frame
        silence(target, round(duration_ms * RATE / 1000) - cursor)


def caption_files(groups: list[Paragraph], directory: Path, width: int, height: int) -> None:
    srt = "\n\n".join(
        f"{i + 1}\n{timecode(p.start_ms, ',')} --> {timecode(p.end_ms, ',')}\n{p.text}"
        for i, p in enumerate(groups)
    )
    (directory / "paragraphs.srt").write_text(srt + "\n", encoding="utf-8")
    size = max(14, round(min(width, height) * 0.030))
    margin = max(12, round(width * 0.06))
    header = (
        f"[Script Info]\nScriptType: v4.00+\nPlayResX: {width}\nPlayResY: {height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,Noto Sans,{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,1,0,2,{margin},{margin},{max(12, height // 25)},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    for p in groups:
        text = p.text.replace("\\", "＼").replace("{", "｛").replace("}", "｝")
        start, end = timecode(p.start_ms)[:-1], timecode(p.end_ms)[:-1]
        header += f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}\n"
    (directory / "subtitles.ass").write_text(header, encoding="utf-8")


def reference_window(project: dict, voiced: list[bool], frame_ms=30, target_ms=20000, *, start_ms=None) -> tuple[int, int]:
    """Select a subtitle-aligned, voiced 20–30 s span; never assume t=0 is speech."""
    length = project["duration_ms"]
    candidates = []
    starts = [start_ms] if start_ms is not None else [s["start_ms"] for s in project["segments"]]
    prefix = [0]
    for is_voice in voiced:
        prefix.append(prefix[-1] + int(is_voice))
    for start in starts:
        end = start + target_ms
        if end > length or end > len(voiced) * frame_ms:
            continue
        # Prefer a real sentence end close to the target; no concatenated fragments.
        ends = [s["end_ms"] for s in project["segments"] if end <= s["end_ms"] <= min(length, end + 10000)
                and sentence_end(s["arabic"])]
        end = min(ends, default=end)
        a, b = start // frame_ms, end // frame_ms
        if b > len(voiced) or b <= a:
            continue
        speech_frames = prefix[b] - prefix[a]
        fraction = speech_frames / (b - a)
        if fraction >= 0.60:
            candidates.append((fraction, -start, start, end))
    if not candidates:
        raise CLIError("Aucune référence avec au moins 60 % de parole détectée. Choisissez --reference-start ou un autre fichier --reference-audio.")
    _, _, start, end = max(candidates)
    return start, end


def extract_reference(video: Path, project: dict, directory: Path, *, start_ms=None, target_ms=20000) -> Path:
    try:
        import webrtcvad
    except ImportError as exc:
        raise CLIError("Le clonage automatique nécessite webrtcvad-wheels : make cli-tts-setup.") from exc
    scan = directory / "reference-scan.wav"
    # Bounded scan; explicit starts permit selecting a passage later in the video.
    offset = max(0, start_ms or 0)
    scan_ms = min(180000, project["duration_ms"] - offset)
    run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(offset / 1000), "-i", str(video),
         "-t", str(scan_ms / 1000), "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(scan)])
    detector = webrtcvad.Vad(2)
    voiced = []
    with wave.open(str(scan), "rb") as handle:
        while len(frame := handle.readframes(480)) == 960:
            voiced.append(detector.is_speech(frame, 16000))
    shifted = dict(project, duration_ms=scan_ms, segments=[
        dict(s, start_ms=s["start_ms"] - offset, end_ms=s["end_ms"] - offset)
        for s in project["segments"] if offset <= s["start_ms"] and s["end_ms"] <= offset + scan_ms
    ])
    start, end = reference_window(shifted, voiced, target_ms=target_ms, start_ms=0 if start_ms is not None else None)
    output = directory / "reference.wav"
    run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(scan), "-ss", str(start / 1000),
         "-t", str((end - start) / 1000), "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(output)])
    selected_frames = voiced[start // 30:end // 30]
    write_json(directory / "reference.json", {"start_ms": start + offset, "end_ms": end + offset,
                                              "method": "webrtcvad-mode2", "minimum_voiced_fraction": 0.60,
                                              "voiced_seconds": sum(selected_frames) * 0.03,
                                              "voiced_fraction": sum(selected_frames) / len(selected_frames),
                                              "sha256": file_hash(output)})
    scan.unlink()
    print(f"Référence clonage : {timecode(start + offset)} → {timecode(end + offset)} ; écoutez {output}")
    return output


def duck_expression(groups: list[Paragraph], bed_db: float) -> str:
    return duck_windows_expression([voice_slot(p) for p in groups], bed_db, attack=.15, release=.4)


def duck_windows_expression(windows, bed_db, *, attack=.35, release=1.0):
    gain = 10 ** (bed_db / 20)
    envelopes = []
    for window in windows:
        a, b = (v / 1000 for v in window)
        # Hold through all pauses inside a paragraph: avoid pumping every word.
        envelopes.append(f"max(0,min(1,min((t-{a - attack:.3f})/{attack:.3f},({b + release:.3f}-t)/{release:.3f})))")
    # FFmpeg parses a+b+c as a left-deep tree and hits its recursion limit on
    # long videos. A balanced sum keeps the same envelope with logarithmic depth.
    while len(envelopes) > 1:
        envelopes = [f"({envelopes[i]}+{envelopes[i + 1]})" if i + 1 < len(envelopes) else envelopes[i]
                     for i in range(0, len(envelopes), 2)]
    return f"1-{1 - gain:.9f}*min(1,({envelopes[0] if envelopes else '0'}))"


def render_mix(video: Path, directory: Path, groups: list[Paragraph], bed_db: float, *, copy_video=False, duck_windows=None) -> None:
    duck = duck_expression(groups, bed_db) if duck_windows is None else duck_windows_expression(duck_windows, bed_db)
    graph = (
        # Bound frame size after loudnorm's buffered output so volume fades are
        # evaluated every 10 ms, including the last seconds of a short clip.
        f"[0:a:0]loudnorm=I=-20:TP=-3:LRA=11,aresample={RATE},asetnsamples=n=480:p=0,"
        f"volume='{duck}':eval=frame[bed];"
        "[1:a:0]aformat=channel_layouts=stereo[voice];"
        "[bed][voice]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=false:latency=true[mix]"
    )
    (directory / "mix.ffscript").write_text(graph, encoding="utf-8")
    run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(video), "-i", "voice.wav",
         "-filter_complex_script", "mix.ffscript", "-map", "[mix]", "-ar", str(RATE),
         "-c:a", "pcm_s24le", "mix.wav"], cwd=directory)
    # Copy mode preserves the source's encoded picture exactly, without FFV1 expansion.
    command = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(video), "-i", "mix.wav"]
    if copy_video:
        command += ["-i", "subtitles.ass", "-map", "0:v:0", "-map", "1:a:0", "-map", "2:s:0",
                    "-c:v", "copy", "-c:s", "ass", "-metadata:s:s:0", "language=fra", "-disposition:s:0", "default"]
    else:
        command += ["-map", "0:v:0", "-map", "1:a:0", "-vf", "ass=subtitles.ass", "-c:v", "ffv1", "-level", "3"]
    command += ["-c:a", "flac", "-map_metadata", "-1", "export.partial.mkv"]
    run(command, cwd=directory)
    (directory / "export.partial.mkv").replace(directory / "export.mkv")


def file_hash(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as handle:
        while data := handle.read(1024 * 1024):
            result.update(data)
    return result.hexdigest()


def export(project: dict, video: Path | None, output: Path, *, backend="auto", model=None,
           speaker="Ryan", target_seconds=60, target_chars=700, clone_source=False,
           reference_audio=None, reference_start=None, reference_seconds=20, bed_db=-18,
           resume=False, plan_only=False, max_tokens=8192, voice_factory=None,
           voice_design=False, voice_description=None, reference_text=None, copy_video=False, batch_size=1,
           engine="qwen") -> dict:
    from qwen_voice import QwenVoice, settings

    if engine not in ("qwen", "piper", "pocket"):
        raise CLIError("Moteur TTS inconnu.")
    if engine == "piper" and (clone_source or reference_audio or reference_text or voice_design or
                                voice_description or reference_start is not None or backend != "auto" or batch_size != 1):
        raise CLIError("Piper utilise une voix française fixe sur CPU, sans clonage, VoiceDesign ni lots MLX.")
    if engine == "pocket" and (clone_source or reference_audio or reference_text or voice_design or
                               voice_description or reference_start is not None or backend != "auto" or batch_size != 1):
        raise CLIError("Pocket utilise Estelle sur CPU, sans clonage, VoiceDesign ni lots MLX.")
    if voice_description and not voice_design:
        raise CLIError("--voice-description nécessite --voice-design.")
    if voice_design and (clone_source or reference_audio):
        raise CLIError("VoiceDesign ne peut pas être mélangé au clonage.")
    transcript = None
    if reference_text:
        if not reference_audio:
            raise CLIError("--reference-text exige --reference-audio avec l'extrait exact correspondant.")
        transcript = reference_text.read_text(encoding="utf-8").strip()
        if not transcript or len(transcript) > 16000:
            raise CLIError("Transcription de référence vide ou trop longue.")
    from qwen_voice import FRENCH_FEMALE_DESIGN
    description = (voice_description or FRENCH_FEMALE_DESIGN) if voice_design else None
    output = output.resolve()
    video = video.resolve() if video else None
    if reference_audio:
        reference_audio = reference_audio.resolve()
    if not math.isfinite(target_seconds) or target_seconds <= 0 or target_chars <= 0:
        raise CLIError("La taille cible des paragraphes doit être positive et finie")
    if reference_start is not None and (not math.isfinite(reference_start) or reference_start < 0):
        raise CLIError("La position de référence doit être positive ou nulle")
    if not math.isfinite(bed_db) or not -60 <= bed_db <= 0:
        raise CLIError("Le niveau original doit être entre -60 et 0 dB")
    if not 3 <= reference_seconds <= 60 or max_tokens < 256:
        raise CLIError("Référence : 3 à 60 secondes ; budget de génération : au moins 256 tokens")
    if clone_source and reference_audio:
        raise CLIError("Choisissez --clone-source OU --reference-audio")
    if not plan_only and (not video or not video.is_file()):
        raise CLIError("Indiquez --video ou fournissez source.mp4 à côté de project.json")
    groups = paragraphs(project["segments"], round(target_seconds * 1000), target_chars)
    info = probe(video) if video else {"width": project.get("width") or 1920, "height": project.get("height") or 1080,
                                      "duration_ms": project.get("duration_ms") or groups[-1].end_ms}
    if info["duration_ms"] < groups[-1].end_ms:
        raise CLIError("La vidéo finit avant les derniers sous-titres")
    piper_assets = None
    factory = QwenVoice
    if engine == "piper":
        from piper_voice import PiperFrenchVoice, assets
        model_path, config_path, speaker_id = assets(speaker, model)
        backend, model = "onnx", str(model_path)
        piper_assets = {"engine": "piper", "language": "fr_FR", "threads": 4,
                        "piper_version": "1.8.0", "speaker_id": speaker_id,
                        "model_sha256": file_hash(model_path), "config_sha256": file_hash(config_path)}
        factory = PiperFrenchVoice
    elif engine == "pocket":
        from pocket_voice import PocketFrenchVoice, assets
        config, weights, tokenizer, preset = assets(model, speaker)
        backend, model = "torch-cpu", str(config)
        piper_assets = {"engine": "pocket", "language": "fr", "variant": "french_24l", "threads": 4,
                        "pocket_version": "3.3.0", "torch_version": "2.14.1", "chunk_tokens": 50,
                        "model_sha256": file_hash(weights), "tokenizer_sha256": file_hash(tokenizer),
                        "preset_sha256": file_hash(preset), "config_sha256": file_hash(config),
                        "seed": "first-32-bits-sha256-paragraph"}
        factory = PocketFrenchVoice
    else:
        backend, model = settings(backend, model, clone_source or bool(reference_audio), voice_design=voice_design)
    if type(batch_size) is not int or not 1 <= batch_size <= 4:
        raise CLIError("Lot TTS : 1 à 4 paragraphes.")
    if batch_size > 1 and (backend != "mlx" or not reference_audio or transcript is None):
        raise CLIError("Les lots TTS exigent MLX et --reference-audio avec --reference-text.")
    plan = {"format": "tarjama-tts-v1", "project_id": project["id"], "source_sha256": source_digest(project),
            "video": str(video) if video else None, "video_sha256": file_hash(video) if video else None,
            "reference_sha256": file_hash(reference_audio) if reference_audio else None,
            "backend": backend, "model": model, "speaker": speaker, "clone_source": clone_source,
            "reference_start": reference_start, "reference_seconds": reference_seconds, "bed_db": bed_db,
            "max_tokens": max_tokens, "media": info, "paragraphs": [asdict(p) for p in groups]}
    from qwen_voice import NARRATION_STYLE
    plan["narration_style"] = description if voice_design else None if clone_source or reference_audio else NARRATION_STYLE
    if piper_assets:
        plan.update(piper_assets, narration_style=None)
    if voice_design:
        plan.update(voice_design=True, speaker=None)
    if transcript is not None:
        plan["reference_text"] = transcript
    if copy_video:
        plan["copy_video"] = True
    exists = output.exists()
    if exists and not resume:
        raise CLIError("Le dossier de sortie existe déjà. Choisissez un nouveau dossier ou --resume.")
    output.mkdir(parents=True, exist_ok=True)
    with locked(output):
        plan_path = output / "plan.json"
        if exists:
            from workspace import read_json
            if not plan_path.is_file() or read_json(plan_path) != plan:
                raise CLIError("Le texte, la vidéo, la référence ou les réglages ont changé : utilisez un nouveau dossier.")
        write_json(plan_path, plan)
        caption_files(groups, output, info["width"], info["height"])
        if plan_only:
            return plan
        reference = reference_audio
        if clone_source:
            reference = output / "reference.wav"
            if not reference.exists():
                reference = extract_reference(video, dict(project, duration_ms=info["duration_ms"]), output,
                                              start_ms=round(reference_start * 1000) if reference_start is not None else None,
                                              target_ms=round(reference_seconds * 1000))
            from workspace import read_json
            if not (output / "reference.json").is_file() or read_json(output / "reference.json").get("sha256") != file_hash(reference):
                raise CLIError("La référence de clonage a changé ou est incomplète : utilisez un nouveau dossier.")
        voice = None
        results = [None] * len(groups)
        pending = []
        for index, p in enumerate(groups):
            raw = output / f"{index:04d}-raw.wav"
            fitted = output / f"{index:04d}-fitted.wav"
            marker = output / f"{index:04d}.json"
            if resume and raw.exists() and fitted.exists() and marker.exists():
                from workspace import read_json
                saved = read_json(marker)
                if saved.get("raw_sha256") == file_hash(raw) and saved.get("fitted_sha256") == file_hash(fitted):
                    results[index] = saved
                    continue
            pending.append(index)
        for offset in range(0, len(pending), batch_size):
            import time
            indices = pending[offset:offset + batch_size]
            print(f"TTS paragraphes {', '.join(str(i + 1) for i in indices)}/{len(groups)} — lot {len(indices)}", flush=True)
            if voice is None:
                kwargs = {"description": description} if voice_design else {}
                if transcript is not None:
                    kwargs["reference_text"] = transcript
                voice = (voice_factory or factory)(backend, model, speaker, reference, max_tokens, **kwargs)
            temporaries = [output / f"{i:04d}-generating.wav" for i in indices]
            generation_start = time.monotonic()
            if len(indices) > 1:
                voice.generate_batch([groups[i].text for i in indices], temporaries)
            else:
                voice.generate(groups[indices[0]].text, temporaries[0])
            generation_seconds = time.monotonic() - generation_start
            for index, temporary in zip(indices, temporaries):
                raw, fitted = output / f"{index:04d}-raw.wav", output / f"{index:04d}-fitted.wav"
                temporary.replace(raw)
                start, end = voice_slot(groups[index])
                result = fit_voice(raw, fitted, end - start)
                result.update(index=index, raw_sha256=file_hash(raw), fitted_sha256=file_hash(fitted))
                result.update(generation_batch_size=len(indices), generation_batch_seconds=round(generation_seconds, 3))
                write_json(output / f"{index:04d}.json", result)
                results[index] = result
            print(f"Lot terminé en {generation_seconds:.1f} s — {len(indices)} paragraphe(s)", flush=True)
        assemble_voice(groups, output, info["duration_ms"], output / "voice.wav")
        render_mix(video, output, groups, bed_db, **({"copy_video": True} if copy_video else {}))
        result = {"paragraphs": results, "output": str(output / "export.mkv"),
                  "output_sha256": file_hash(output / "export.mkv")}
        write_json(output / "result.json", result)
        return result
