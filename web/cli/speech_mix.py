"""Speech-aware documentary cues, distinct from subtitle/paragraph boundaries."""
from array import array
import math
from pathlib import Path
import sys
import wave

from tts_export import run, voice_slot
from workspace import CLIError

FRAME_MS = 30


def regions(flags, *, frame_ms=FRAME_MS, min_speech_ms=240):
    """Bridge tiny consonant gaps, then reject isolated short VAD triggers."""
    flags = list(flags)
    for index in range(1, len(flags) - 1):
        if not flags[index] and flags[index - 1]:
            end = index
            while end < len(flags) and not flags[end] and (end - index) * frame_ms <= 90:
                end += 1
            if end < len(flags) and flags[end] and (end - index) * frame_ms <= 90:
                flags[index:end] = [True] * (end - index)
    spans, start = [], None
    for index, active in enumerate([*flags, False]):
        if active and start is None:
            start = index
        elif not active and start is not None:
            if (index - start) * frame_ms >= min_speech_ms:
                spans.append((start * frame_ms, index * frame_ms))
            start = None
    return spans


def detect_speech(media, wav, *, seconds=None):
    try:
        import webrtcvad
    except ImportError as exc:
        raise CLIError("La détection de parole nécessite make cli-tts-setup.") from exc
    command = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(media)]
    if seconds is not None:
        command += ["-t", str(seconds)]
    run([*command, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)])
    return analyze_wav(wav, webrtcvad.Vad(2))


def analyze_wav(wav, detector):
    flags = []
    with wave.open(str(wav), "rb") as handle:
        while len(frame := handle.readframes(480)) == 960:
            samples = array("h", frame)
            if sys.byteorder != "little":
                samples.byteswap()
            rms = math.sqrt(sum(int(s) ** 2 for s in samples) / len(samples))
            # VAD plus a low energy floor avoids treating room noise as speech.
            # Feed silence too, so WebRTC's hangover state can actually decay.
            active = detector.is_speech(frame, 16000)
            flags.append(rms >= 32768 * 10 ** (-50 / 20) and active)
    return regions(flags)


def introductions(groups, source_regions, *, listen_ms=1500, restart_silence_ms=3000):
    """Return source prefix ends after actual voiced time, not wall-clock time."""
    ends, cues = {}, []
    previous_speech_end = None
    for index, group in enumerate(groups):
        speech = [(max(a, group.start_ms), min(b, group.end_ms)) for a, b in source_regions
                  if a < group.end_ms and b > group.start_ms]
        if not speech:
            raise CLIError(f"Aucune parole originale détectée dans le paragraphe {index + 1} : vérifier le média.")
        restart = previous_speech_end is None or speech[0][0] - previous_speech_end >= restart_silence_ms
        if restart:
            # Keep some source picture after the intro for the French take.
            available = [(a, min(b, group.end_ms - 300)) for a, b in speech if a < group.end_ms - 300]
            available = [(a, b) for a, b in available if b > a]
            available_ms = sum(b - a for a, b in available)
            budget = available_ms // 2 if available_ms < listen_ms else listen_ms
            if budget < 240:
                raise CLIError(f"Parole originale trop courte pour une introduction sûre au paragraphe {index + 1}.")
            remaining = budget
            for a, b in available:
                if b - a >= remaining:
                    end = a + remaining
                    break
                remaining -= b - a
            ends[index] = end
            cues.append({"paragraph": index, "speech_start_ms": speech[0][0], "intro_end_ms": end,
                         "voiced_listen_ms": budget, "reason": "start" if previous_speech_end is None else "long_silence"})
        previous_speech_end = speech[-1][1]
    return ends, cues


def duck_windows(groups, french_regions, *, hold_gap_ms=3000):
    """Hold low through internal pauses and short inter-paragraph gaps."""
    windows = []
    for group, speech in zip(groups, french_regions):
        if not speech:
            raise CLIError("Aucune parole française détectée : impossible de caler le mixage.")
        raw_start, raw_end = speech[0][0], speech[-1][1]
        slot_start, slot_end = voice_slot(group)
        a, b = slot_start + raw_start, min(slot_end, slot_start + raw_end) + 300
        if windows and a - windows[-1][1] <= hold_gap_ms:
            windows[-1][1] = b
        else:
            windows.append([a, b])
    return windows
