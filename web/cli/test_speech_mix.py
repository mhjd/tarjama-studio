import unittest
import math
from pathlib import Path
import tempfile
import wave

from speech_mix import analyze_wav, duck_windows, introductions, regions
from retime_video import timeline
from tts_export import Paragraph, RATE, caption_files, render_mix, run
from workspace import CLIError


class SpeechMixTests(unittest.TestCase):
    def test_background_is_28_db_lower_and_stays_low_during_french_pauses(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "source.mp4"
            run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=160x90:r=12:d=6",
                 "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(video)])
            with wave.open(str(root / "voice.wav"), "wb") as handle:
                handle.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
                handle.writeframes(b"\0\0" * RATE * 6)
            groups = [Paragraph(["a"], 0, 5000, "Texte.")]
            caption_files(groups, root, 160, 90)
            render_mix(video, root, groups, -28, copy_video=True, duck_windows=[[1000, 4000]])
            def rms_at(seconds):
                with wave.open(str(root / "mix.wav"), "rb") as handle:
                    handle.setpos(round(seconds * RATE))
                    data = handle.readframes(round(.2 * RATE))
                values = [int.from_bytes(data[i:i + 3], "little", signed=True) for i in range(0, len(data), 3)]
                return math.sqrt(sum(v * v for v in values) / len(values))
            self.assertAlmostEqual(20 * math.log10(rms_at(1.5) / rms_at(5.5)), -28, delta=.6)
            self.assertAlmostEqual(20 * math.log10(rms_at(2.8) / rms_at(1.5)), 0, delta=.6)

    def test_vad_receives_silent_frames_without_counting_them_as_speech(self):
        calls = []
        class Detector:
            def is_speech(self, frame, rate):
                calls.append(frame)
                return True
        with tempfile.TemporaryDirectory() as directory:
            wav = Path(directory) / "silence.wav"
            with wave.open(str(wav), "wb") as handle:
                handle.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                handle.writeframes(b"\0\0" * 480 * 20)
            self.assertEqual(analyze_wav(wav, Detector()), [])
        self.assertEqual(len(calls), 20)

    def test_intro_ignores_initial_and_intermediate_silence(self):
        groups = [Paragraph(["a"], 0, 10000, "Bonjour.")]
        ends, cues = introductions(groups, [(4000, 4500), (5500, 8000)])
        # 4 s initial silence and 1 s pause do not count as original speech.
        self.assertEqual(ends, {0: 6500})
        self.assertEqual(cues[0]["voiced_listen_ms"], 1500)
        self.assertEqual(cues[0]["speech_start_ms"], 4000)
        pieces, mapped, _ = timeline(groups, [4], 10000, 24, intro_ends=ends)
        self.assertEqual(pieces[0]["kind"], "speech_intro")
        self.assertEqual(pieces[0]["source_start_ms"], 0)
        self.assertEqual(pieces[0]["source_end_ms"], 6500)
        self.assertAlmostEqual(pieces[0]["source_speed"], 1)
        self.assertGreaterEqual(mapped[0].start_ms, 6500)
        self.assertEqual(pieces[1]["source_start_ms"], 6500)

    def test_intro_only_at_start_and_after_a_real_long_silence(self):
        groups = [Paragraph(["a"], 0, 5000, "Un."), Paragraph(["b"], 5000, 10000, "Deux."),
                  Paragraph(["c"], 10000, 18000, "Trois.")]
        ends, cues = introductions(groups, [(1000, 4800), (5100, 8500), (12500, 17500)])
        self.assertEqual(set(ends), {0, 2})
        self.assertEqual([c["reason"] for c in cues], ["start", "long_silence"])
        self.assertEqual(ends[2], 14000)

    def test_ducking_holds_through_internal_and_short_boundary_pauses(self):
        groups = [Paragraph(["a"], 0, 10000, "Un."), Paragraph(["b"], 10000, 15000, "Deux."),
                  Paragraph(["c"], 22000, 27000, "Trois.")]
        windows = duck_windows(groups, [[(500, 2500), (4000, 8000)], [(0, 3500)], [(200, 3500)]])
        self.assertEqual(len(windows), 2)
        self.assertEqual(windows[0][0], 850)
        self.assertGreater(windows[0][1], 13000)
        self.assertLess(windows[0][1], windows[1][0])

    def test_noise_bursts_and_silent_media_do_not_trigger_an_intro(self):
        flags = [False] * 20 + [True] * 3 + [False] * 10 + [True] * 20
        self.assertEqual(regions(flags), [(990, 1590)])
        with self.assertRaisesRegex(CLIError, "Aucune parole"):
            introductions([Paragraph(["a"], 0, 5000, "Texte.")], [])
