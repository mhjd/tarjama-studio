from __future__ import annotations

import argparse
import copy
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave
from types import SimpleNamespace

import main
import qwen_voice
from tts_export import (Paragraph, assemble_voice, atempo, duck_expression, export,
                        fit_voice, paragraphs, reference_window, render_mix, run, sentence_end, voice_slot)
from workspace import (CLIError, load_project, milliseconds, parse_response, prompt,
                       read_json, source_digest, write_json)


def segment(sid, start, end, text):
    return {"id": str(sid), "start_ms": start, "end_ms": end, "arabic": "نص عربي.", "french": text, "version": 1}


def project():
    return {"id": "local_test", "title": "Essai", "version": 1, "arabic_version": 1,
            "duration_ms": 6000, "segments": [segment(0, 500, 2000, "Bonjour."),
                                             segment(1, 4000, 5500, "Ceci est une seconde phrase.")]}


def tone(path: Path, seconds: float, hz=220):
    rate = 24000
    with wave.open(str(path), "wb") as handle:
        handle.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        samples = (int(math.sin(2 * math.pi * hz * i / rate) * 8000) for i in range(round(rate * seconds)))
        handle.writeframes(b"".join(struct.pack("<h", value) for value in samples))


class ParagraphTests(unittest.TestCase):
    def test_mlx_batch_keeps_sequence_identity_and_rejects_missing_audio(self):
        voice = object.__new__(qwen_voice.QwenVoice)
        voice.backend, voice.reference, voice.reference_text = "mlx", Path("reference.wav"), "Texte de référence."
        voice.max_tokens = 2048
        written, called = [], []
        voice.sf = SimpleNamespace(write=lambda path, audio, rate, **kw: written.append(path))
        chunks = [SimpleNamespace(sequence_idx=i, token_count=4, audio=[0.0] * 2400, sample_rate=24000) for i in (1, 0)]
        def batch(**kwargs):
            called.append(kwargs)
            yield from chunks
        voice.model = SimpleNamespace(batch_generate=batch)
        outputs = [Path("a.wav"), Path("b.wav")]
        with patch.dict(sys.modules, {"numpy": SimpleNamespace(asarray=lambda value: value)}):
            voice.generate_batch(["Bonjour.", "Bonsoir."], outputs)
            self.assertEqual(written, ["b.wav", "a.wav"])
            self.assertEqual(called[0]["ref_text"], voice.reference_text)
            self.assertEqual(called[0]["lang_code"], "French")
            self.assertNotIn("voices", called[0])
            chunks.pop()
            with self.assertRaisesRegex(CLIError, "incomplet"):
                voice.generate_batch(["Bonjour.", "Bonsoir."], outputs)

    def test_desktop_import_is_a_validated_read_only_copy(self):
        from desktop_import import import_desktop
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, output = root / "desktop", root / "copy"
            source.mkdir()
            rows = [{"id": "0", "start": 0.72, "end": 2.56, "text": "السلام عليكم."}]
            translated = [{"id": "0", "start": 0.71999997, "end": 2.56, "translation": "Bonjour."}]
            write_json(source / "project.json", {"id": "desktop_1", "title": "Sirat"})
            write_json(source / "current.json", {"corpus_id": "desktop_1", "segments": rows})
            write_json(source / "translation.json", {"corpus_id": "desktop_1", "segments": translated,
                       "source_transcript_fingerprint": json.dumps(rows)})
            (source / "source.mp4").write_bytes(b"test video")
            before = {p.name: p.read_bytes() for p in source.iterdir()}
            with patch("desktop_import.probe", return_value={"duration_ms": 3000}):
                value = import_desktop(source, output)
                self.assertEqual(value["segments"][0]["start_ms"], 720)
                self.assertEqual(load_project(output, translated=True), value)
                self.assertEqual(before, {p.name: p.read_bytes() for p in source.iterdir()})
                with self.assertRaises(FileExistsError):
                    import_desktop(source, output)
                translated[0]["start"] = 0.8
                write_json(source / "translation.json", {"corpus_id": "desktop_1", "segments": translated})
                with self.assertRaisesRegex(CLIError, "désalignés"):
                    import_desktop(source, root / "bad-copy")
                self.assertFalse((root / "bad-copy").exists())

    def test_voice_design_is_17b_and_not_a_preset_or_clone(self):
        for backend in ("mlx", "torch"):
            _, model = qwen_voice.settings(backend, None, False, voice_design=True)
            self.assertIn("1.7B-VoiceDesign", model)
        with self.assertRaises(CLIError):
            qwen_voice.settings("mlx", None, True, voice_design=True)
        calls = []
        voice = object.__new__(qwen_voice.QwenVoice)
        voice.backend, voice.speaker, voice.reference = "mlx", "Ryan", None
        voice.description, voice.max_tokens = "Native French female narrator.", 2048
        voice.sf = SimpleNamespace(write=lambda *args, **kwargs: None)

        def generate(**kwargs):
            calls.append(kwargs)
            return iter([SimpleNamespace(audio=[0.0] * 2400, sample_rate=24000, token_count=2)])

        voice.model = SimpleNamespace(generate=generate)
        with patch.dict(sys.modules, {"numpy":SimpleNamespace(asarray=lambda value:value)}):
            voice.generate("Bonjour.", Path("unused.wav"))
        self.assertEqual(calls[0]["lang_code"], "French")
        self.assertEqual(calls[0]["instruct"], voice.description)
        self.assertNotIn("voice", calls[0])
        self.assertNotIn("ref_audio", calls[0])
        voice.backend = "torch"

        def design(**kwargs):
            calls.append(kwargs)
            return [[0.0] * 2400], 24000

        voice.model = SimpleNamespace(generate_voice_design=design)
        voice.generate("Bonjour.", Path("unused.wav"))
        self.assertEqual(calls[1]["language"], "French")
        self.assertEqual(calls[1]["instruct"], voice.description)
        self.assertNotIn("speaker", calls[1])

    def test_french_reference_text_is_passed_to_mlx_clone(self):
        voice = object.__new__(qwen_voice.QwenVoice)
        voice.backend, voice.speaker, voice.reference = "mlx", "", Path("reference.wav")
        voice.description, voice.reference_text, voice.max_tokens = None, "La référence française.", 2048
        voice.sf = SimpleNamespace(write=lambda *args, **kwargs: None)
        calls = []

        def generate(**kwargs):
            calls.append(kwargs)
            return iter([SimpleNamespace(audio=[0.0] * 2400, sample_rate=24000, token_count=2)])

        voice.model = SimpleNamespace(generate=generate)
        with patch.dict(sys.modules, {"numpy":SimpleNamespace(asarray=lambda value:value)}):
            voice.generate("Texte cible différent.", Path("unused.wav"))
        self.assertEqual(calls[0]["ref_text"], "La référence française.")
        self.assertEqual(calls[0]["ref_audio"], "reference.wav")
        self.assertEqual(calls[0]["text"], "Texte cible différent.")
        self.assertNotIn("voice", calls[0])

    def test_model_defaults_stay_on_17b_and_select_clone_variant(self):
        for backend in ("mlx", "torch"):
            for clone, variant in ((False, "CustomVoice"), (True, "Base")):
                selected, model = qwen_voice.settings(backend, None, clone)
                self.assertEqual(selected, backend)
                self.assertIn("1.7B-" + variant, model)

    def test_sentence_crosses_subtitles_without_speed_change(self):
        segments = [segment(0, 0, 10000, "Le début d'une phrase"), segment(1, 10000, 20000, "qui se termine ici."),
                    segment(2, 20000, 30000, "Une autre phrase."), segment(3, 30000, 40000, "La conclusion.")]
        result = paragraphs(segments, target_ms=30000)
        self.assertEqual([p.ids for p in result], [["0", "1", "2"], ["3"]])
        self.assertEqual((result[0].start_ms, result[0].end_ms), (0, 30000))
        self.assertEqual(segments[0]["end_ms"], 10000)

    def test_long_sentence_uses_soft_limit_instead_of_cutting(self):
        result = paragraphs([segment(0, 0, 30000, "Une phrase"), segment(1, 30000, 90000, "qui dure longtemps.")], target_ms=20000)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].end_ms, 90000)

    def test_abbreviations_quotes_and_final_fragment(self):
        self.assertFalse(sentence_end("Le docteur M."))
        self.assertFalse(sentence_end("Une hésitation..."))
        self.assertFalse(sentence_end("Les U.S.A."))
        self.assertTrue(sentence_end("« Une citation. » (référence 12)"))
        segments = [segment(0, 0, 1000, "M."), segment(1, 1000, 2000, "Dupont répond."),
                    segment(2, 2000, 3000, "Dernier fragment")]
        result = paragraphs(segments, target_ms=1000)
        self.assertEqual([p.ids for p in result], [["0", "1"], ["2"]])

    def test_gap_preserved_only_after_complete_sentence(self):
        segments = [segment(0, 0, 1000, "Début"), segment(1, 5000, 6000, "et fin."),
                    segment(2, 9000, 10000, "Après la pause.")]
        self.assertEqual([p.ids for p in paragraphs(segments)], [["0", "1"], ["2"]])

    def test_missing_translation_and_extremely_long_sentence_rejected(self):
        for text in ("", "mot " * 1100):
            with self.assertRaises(CLIError):
                paragraphs([segment(0, 0, 1000, text)])

    def test_reference_avoids_initial_silence(self):
        value = {"duration_ms": 60000, "segments": [
            segment(0, 0, 10000, "Une introduction mal alignée."),
            segment(1, 10000, 30000, "Texte."), segment(2, 30000, 50000, "Suite.")]}
        vad = [False] * 333 + [True] * 1500 + [False] * 167
        a, b = reference_window(value, vad)
        self.assertGreaterEqual(a, 10000)
        self.assertGreaterEqual(b - a, 20000)
        with self.assertRaises(CLIError):
            reference_window(value, [False] * 2000)

    def test_tempo_chain_preserves_requested_factor(self):
        for rate in (0.1, 0.5, 1.3, 2, 5.8):
            factors = [float(item.split("=")[1]) for item in atempo(rate).split(",")]
            self.assertTrue(all(0.5 <= factor <= 2 for factor in factors))
            self.assertAlmostEqual(math.prod(factors), rate, places=9)


class ManualWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.path = self.directory / "project.json"
        self.project = project()
        write_json(self.path, self.project)

    def tearDown(self):
        self.temp.cleanup()

    def response(self, first="Bonjour corrigé."):
        return ("# Translation\nsource_corpus_id: local_test\nlanguage: fr\nformat: tarjama-translation-v1\n"
                f"## 00:00.500 --> 00:02.000\n{first}\n\n## 00:04.000 --> 00:05.500\nDeuxième phrase.\n")

    def test_current_web_api_wrapper_loads_and_old_format_does_not(self):
        write_json(self.path, {"project": self.project, "jobs": []})
        self.assertEqual(load_project(self.path), self.project)
        write_json(self.path, {"corpus_id": "old", "segments": []})
        with self.assertRaises(CLIError):
            load_project(self.path)

    def test_prompt_has_no_unresolved_variables(self):
        for kind in ("cleanup", "translation"):
            text = prompt(self.project, kind)
            self.assertIn("source_corpus_id: local_test", text)
            self.assertNotIn("{{", text)
            self.assertNotIn("exclusivement par Parallel", text)
            self.assertNotIn("utilise `web_search`", text)

    def test_equivalent_hours_and_invalid_total_minutes(self):
        self.assertEqual(milliseconds("1:00:01.120"), milliseconds("01:00:01.120"))
        for invalid in ("60:01.120", "00:60:01.120", "01:00:60.000"):
            with self.assertRaises(CLIError):
                milliseconds(invalid)

    def test_import_rejects_wrong_project_dropped_and_duplicate_blocks(self):
        for bad in (self.response().replace("local_test", "other"), self.response().split("## 00:04")[0],
                    self.response().replace("00:04.000 --> 00:05.500", "00:00.500 --> 00:02.000")):
            with self.assertRaises(CLIError):
                parse_response(bad, self.project, "translation")

    def test_import_increments_versions_without_touching_timestamps(self):
        before = self.path.read_bytes()
        main.prompt_command(argparse.Namespace(project=self.path, kind="translation", no_copy=True))
        response = self.directory / "response.md"
        response.write_text(self.response(), encoding="utf-8")
        main.import_command(argparse.Namespace(project=self.path, kind="translation", clipboard=False, file=response))
        after = load_project(self.path)
        self.assertEqual(after["segments"][0]["french"], "Bonjour corrigé.")
        self.assertEqual(after["segments"][0]["start_ms"], 500)
        self.assertEqual(after["version"], 2)
        self.assertEqual(next((self.directory / "imports").glob("*-before.json")).read_bytes(), before)

    def test_stale_response_never_overwrites_current_text(self):
        main.prompt_command(argparse.Namespace(project=self.path, kind="cleanup", no_copy=True))
        self.project["segments"][0]["arabic"] = "تعديل آخر."
        write_json(self.path, self.project)
        response = self.directory / "response.md"
        response.write_text(self.response(), encoding="utf-8")
        with self.assertRaises(CLIError):
            main.import_command(argparse.Namespace(project=self.path, kind="cleanup", clipboard=False, file=response))
        self.assertEqual(load_project(self.path), self.project)

    def test_chunk_import_preserves_other_segments(self):
        main.prompt_command(argparse.Namespace(project=self.path, kind="translation", no_copy=True, chunk=1, chunk_minutes=0.05))
        response = self.directory / "response.md"
        response.write_text(self.response().split("## 00:04")[0], encoding="utf-8")
        main.import_command(argparse.Namespace(project=self.path, kind="translation", clipboard=False, file=response))
        after = load_project(self.path)
        self.assertEqual(after["segments"][0]["french"], "Bonjour corrigé.")
        self.assertEqual(after["segments"][1], self.project["segments"][1])

    def test_plan_needs_no_tts_dependency_and_detects_source_changes(self):
        output = self.directory / "plan"
        export(self.project, None, output, plan_only=True)
        self.assertTrue((output / "paragraphs.srt").is_file())
        self.assertIn("Noto Sans,32,", (output / "subtitles.ass").read_text())
        changed = copy.deepcopy(self.project)
        changed["segments"][0]["french"] = "Autre texte."
        with self.assertRaises(CLIError):
            export(changed, None, output, resume=True, plan_only=True)

    def test_voice_design_plan_records_description_and_rejects_clone(self):
        output = self.directory / "design-plan"
        plan = export(self.project, None, output, plan_only=True, voice_design=True)
        self.assertIn("1.7B-VoiceDesign", plan["model"])
        self.assertTrue(plan["voice_design"])
        self.assertIsNone(plan["speaker"])
        self.assertEqual(plan["narration_style"], qwen_voice.FRENCH_FEMALE_DESIGN)
        export(self.project, None, output, plan_only=True, voice_design=True, resume=True)
        with self.assertRaises(CLIError):
            export(self.project, None, output, plan_only=True, voice_design=True,
                   voice_description="Another voice", resume=True)
        with self.assertRaises(CLIError):
            export(self.project, None, output, plan_only=True, voice_design=True, clone_source=True)
        with self.assertRaises(CLIError):
            export(self.project, None, output, plan_only=True, voice_description="Ignored description")

    def test_reference_transcript_is_a_resume_identity_and_requires_audio(self):
        audio, transcript = self.directory / "ref.wav", self.directory / "ref.txt"
        tone(audio, .1)
        transcript.write_text("Paroles de référence.", encoding="utf-8")
        output = self.directory / "reference-plan"
        plan = export(self.project, None, output, plan_only=True,
                      reference_audio=audio, reference_text=transcript)
        self.assertIn("1.7B-Base", plan["model"])
        self.assertEqual(plan["reference_text"], "Paroles de référence.")
        transcript.write_text("Autres paroles.", encoding="utf-8")
        with self.assertRaises(CLIError):
            export(self.project, None, output, plan_only=True, resume=True,
                   reference_audio=audio, reference_text=transcript)
        with self.assertRaises(CLIError):
            export(self.project, None, self.directory / "invalid", plan_only=True, reference_text=transcript)

    def test_voice_sample_preserves_project_and_refuses_overwrite(self):
        output = self.directory / "sample"
        args = argparse.Namespace(project=self.path, output=output, backend="mlx", model=None, voice_description=None)
        descriptions = []

        class FakeVoice:
            def __init__(self, backend, model, speaker, reference, max_tokens, *, description):
                descriptions.append(description)
                self.assertions = (speaker, reference, max_tokens)

            def generate(self, text, destination):
                tone(destination, .1)

        with patch.object(qwen_voice, "QwenVoice", FakeVoice):
            main.voice_sample_command(args)
            with self.assertRaises(FileExistsError):
                main.voice_sample_command(args)
        self.assertEqual(descriptions, [qwen_voice.FRENCH_FEMALE_DESIGN])
        self.assertEqual(read_json(self.path), self.project)
        self.assertTrue((output / "sample.wav").is_file())
        self.assertEqual(read_json(output / "sample.json")["language"], "French")


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg et ffprobe requis")
class MediaIntegrationTests(unittest.TestCase):
    def test_long_video_ducking_stays_within_ffmpeg_parser_depth(self):
        for count in (99, 500):
            groups = [Paragraph([str(i)], i * 1000, i * 1000 + 700, "Bonjour.") for i in range(count)]
            expression = duck_expression(groups, -18)
            run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
                 "-af", f"volume='{expression}':eval=frame", "-t", "0.1", "-f", "null", "-"])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_constant_tempo_is_sample_exact_and_preserves_pitch(self):
        raw, fitted = self.directory / "raw.wav", self.directory / "fitted.wav"
        tone(raw, 2, hz=440)
        for duration in (1000, 4000):
            fit_voice(raw, fitted, duration)
            with wave.open(str(fitted), "rb") as handle:
                self.assertEqual(handle.getnframes(), duration * 48)
                data = struct.unpack("<" + "h" * handle.getnframes(), handle.readframes(handle.getnframes()))
            a, b = len(data) // 4, len(data) * 3 // 4
            crossings = sum(data[i - 1] <= 0 < data[i] for i in range(a + 1, b))
            self.assertAlmostEqual(crossings / ((b - a) / 48000), 440, delta=12)

    def test_full_export_with_real_ffmpeg_and_resume(self):
        video = self.directory / "source.mp4"
        run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=160x90:r=12:d=6",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-shortest", str(video)])

        class FakeVoice:
            calls = 0

            def __init__(self, *args):
                pass

            def generate(self, text, output):
                self.__class__.calls += 1
                tone(output, 1)

        output = self.directory / "export"
        value = export(project(), video, output, backend="torch", voice_factory=FakeVoice)
        self.assertEqual(FakeVoice.calls, 2)
        self.assertTrue(Path(value["output"]).stat().st_size > 1000)
        with wave.open(str(output / "voice.wav"), "rb") as handle:
            self.assertEqual(handle.getnframes(), 6000 * 48)
            handle.setpos(2500 * 48)
            self.assertEqual(set(handle.readframes(48000)), {0})
        media = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", value["output"]]))
        self.assertEqual(media["streams"][0]["codec_name"], "ffv1")
        self.assertEqual(media["streams"][1]["codec_name"], "flac")
        self.assertEqual((media["streams"][0]["width"], media["streams"][0]["height"]), (160, 90))
        export(project(), video, output, backend="torch", resume=True, voice_factory=FakeVoice)
        self.assertEqual(FakeVoice.calls, 2, "Reprise : aucun nouvel appel TTS pour un paragraphe terminé")
        master = (output / "export.mkv").read_bytes()
        main.preview_command(argparse.Namespace(export=output))
        preview = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(output / "audit.mp4")]))
        self.assertEqual(preview["streams"][0]["codec_name"], "h264")
        self.assertEqual(preview["streams"][1]["codec_name"], "aac")
        self.assertEqual((preview["streams"][0]["width"], preview["streams"][0]["height"]), (160, 90))
        self.assertEqual((output / "export.mkv").read_bytes(), master)
        with self.assertRaises(CLIError):
            main.preview_command(argparse.Namespace(export=output))
        copied = self.directory / "copy-export"
        copied_result = export(project(), video, copied, backend="torch", voice_factory=FakeVoice, copy_video=True)
        copied_media = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", copied_result["output"]]))
        self.assertEqual([s["codec_name"] for s in copied_media["streams"]], ["h264", "flac", "ass"])
        # Compare encoded picture packets, not decoded frames: no video recompression.
        def picture_packets(path):
            return json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_packets",
                                   "-show_data_hash", "sha256", "-show_entries", "packet=data_hash", "-of", "json", str(path)]))
        self.assertEqual(picture_packets(video), picture_packets(copied / "export.mkv"))
        export(project(), video, copied, backend="torch", voice_factory=FakeVoice, copy_video=True, resume=True)
        self.assertEqual(FakeVoice.calls, 4)
        with self.assertRaises(CLIError):
            export(project(), video, copied, backend="torch", voice_factory=FakeVoice, resume=True)
        main.preview_command(argparse.Namespace(export=copied))
        self.assertTrue((copied / "audit.mp4").is_file())
        reference, reference_text = self.directory / "reference.wav", self.directory / "reference.txt"
        tone(reference, 1)
        reference_text.write_text("Bonjour.")
        class BatchVoice:
            batches = 0
            def __init__(self, *args, **kwargs):
                pass
            def generate_batch(self, texts, outputs):
                self.__class__.batches += 1
                for path in outputs:
                    tone(path, 1)
        batched = self.directory / "batched"
        options = dict(backend="mlx", voice_factory=BatchVoice, reference_audio=reference,
                       reference_text=reference_text, copy_video=True)
        export(project(), video, batched, batch_size=2, **options)
        self.assertEqual(BatchVoice.batches, 1)
        # Batch size is an execution setting, not a change to the narration plan.
        resumed = export(project(), video, batched, resume=True, batch_size=4, **options)
        self.assertEqual(BatchVoice.batches, 1)
        self.assertEqual([p["index"] for p in resumed["paragraphs"]], [0, 1])

    def test_original_is_lowered_during_paragraph_and_returns_in_gap(self):
        video = self.directory / "source.mp4"
        run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=160x90:r=12:d=6",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(video)])
        with wave.open(str(self.directory / "voice.wav"), "wb") as handle:
            handle.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
            handle.writeframes(b"\0\0" * (6 * 48000))
        (self.directory / "subtitles.ass").write_text("[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\n[Events]\n")
        groups = [Paragraph(["0"], 500, 2500, "Test.")]
        render_mix(video, self.directory, groups, -18)

        def rms_at(seconds):
            with wave.open(str(self.directory / "mix.wav"), "rb") as handle:
                self.assertEqual(handle.getsampwidth(), 3)
                handle.setpos(round(seconds * handle.getframerate()))
                data = handle.readframes(round(0.2 * handle.getframerate()))
            values = [int.from_bytes(data[i:i + 3], "little", signed=True) for i in range(0, len(data), 3)]
            return math.sqrt(sum(value * value for value in values) / len(values))

        attenuation = 20 * math.log10(rms_at(1.2) / rms_at(4))
        self.assertAlmostEqual(attenuation, -18, delta=0.6)


if __name__ == "__main__":
    unittest.main()
