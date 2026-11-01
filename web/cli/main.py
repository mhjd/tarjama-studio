#!/usr/bin/env python3
"""Tarjama local CLI: current web projects, manual ChatGPT workflow, local TTS."""

from __future__ import annotations

import argparse
import copy
import http.cookiejar
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

from workspace import (CLIError, atomic_write, clipboard, load_project, locked,
                       parse_response, project_file, prompt, read_json, source_digest, write_json)
from tts_export import export, probe, run


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class WebClient:
    """Read-only client; cookies also support the VPS's separate access layer."""

    def __init__(self, url: str, cookies: Path):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise CLIError("URL du serveur invalide")
        if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise CLIError("HTTPS obligatoire hors loopback")
        self.url = url.rstrip("/")
        jar = http.cookiejar.MozillaCookieJar()
        try:
            jar.load(str(cookies), ignore_discard=True)
        except (OSError, http.cookiejar.LoadError) as exc:
            raise CLIError("Fichier de cookies Netscape illisible") from exc
        self.opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPCookieProcessor(jar))

    def get(self, path: str):
        try:
            return self.opener.open(self.url + path, timeout=120)
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308, 401, 403):
                raise CLIError("Session web expirée ou accès refusé. Renouvelez le fichier de cookies.") from exc
            raise CLIError(f"Lecture serveur impossible (HTTP {exc.code})") from exc
        except urllib.error.URLError as exc:
            raise CLIError("Serveur inaccessible") from exc

    def json(self, path: str):
        with self.get(path) as response:
            if "application/json" not in response.headers.get("Content-Type", ""):
                raise CLIError("Le serveur renvoie une page de connexion au lieu du JSON attendu")
            data = response.read(64 * 1024 * 1024 + 1)
            if len(data) > 64 * 1024 * 1024:
                raise CLIError("Réponse JSON trop volumineuse")
            try:
                return json.loads(data)
            except ValueError as exc:
                raise CLIError("Réponse serveur JSON invalide") from exc


def web_client(args) -> WebClient:
    if not args.url or not args.cookies:
        raise CLIError("--url et --cookies sont nécessaires pour lire un compte web")
    return WebClient(args.url, args.cookies)


def projects_command(args):
    rows = web_client(args).json("/api/projects")
    for p in rows or []:
        print(f"{p['id']}\t{p['stage']}\t{p['title']}")


def fetch_command(args):
    client = web_client(args)
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,160}", args.id):
        raise CLIError("Identifiant de projet invalide")
    project_path = "/api/projects/" + args.id
    before = client.json(project_path)["project"]
    if before.get("media_expired") or not before.get("media"):
        raise CLIError("La vidéo web est absente ou expirée. Récupérez-la dans l'application ou utilisez un fichier vidéo local.")
    args.output.mkdir(parents=True, exist_ok=False)
    with locked(args.output):
        temporary = args.output / "source.partial"
        with client.get(project_path + "/media") as response, temporary.open("xb") as target:
            if "text/html" in response.headers.get("Content-Type", ""):
                raise CLIError("Page de connexion reçue à la place de la vidéo")
            shutil.copyfileobj(response, target, length=1024 * 1024)
        after = client.json(project_path)["project"]
        if source_digest(before) != source_digest(after) or any(before.get(key) != after.get(key) for key in ("version", "generation", "media")):
            raise CLIError("Le projet a changé pendant la copie. Recommencez dans un nouveau dossier.")
        probe(temporary)
        temporary.rename(args.output / "source.mp4")
        write_json(args.output / "project.json", before)
    print(args.output / "project.json")
    print("Copie locale : aucune modification n'a été envoyée au serveur.")


def create_command(args):
    args.output.mkdir(parents=True, exist_ok=False)
    with locked(args.output):
        video = args.output.resolve() / "source.mp4"
        if args.video:
            # Containers are probed, so an imported MOV/MKV can keep its bytes here.
            with args.video.open("rb") as source, video.open("xb") as target:
                shutil.copyfileobj(source, target)
        else:
            local_ytdlp = Path(sys.executable).parent / "yt-dlp"
            command = [str(local_ytdlp) if local_ytdlp.is_file() else "yt-dlp", "--ignore-config", "--no-playlist", "--max-filesize", "8G",
                       "--merge-output-format", "mp4", "--remux-video", "mp4",
                       "-f", "bv*[height<=1080]+ba/b[height<=1080]/best",
                       "-o", str(video.with_suffix(".%(ext)s"))]
            if args.proxy:
                command += ["--proxy", args.proxy]
            command += ["--", args.link]
            run(command, timeout=3600)
        info = probe(video)
        project = {"id": "local_" + uuid.uuid4().hex, "title": args.title or (args.video.stem if args.video else args.link),
                   "stage": "transcribing", "version": 1, "arabic_version": 0, "confirmed_arabic": 0,
                   "translation_source": 0, "confirmed_review": 0, "generation": 1,
                   "media": "source.mp4", "segments": [], **info}
        write_json(args.output / "project.json", project)
    print(args.output / "project.json")


def import_asr_command(args):
    path = project_file(args.project)
    with locked(path.parent):
        project = load_project(path, allow_empty=True)
        if project["segments"]:
            raise CLIError("Une transcription existe déjà ; créez un nouveau projet pour préserver le travail courant.")
        raw = read_json(args.file)
        segments, previous_end = [], 0
        for index, s in enumerate(raw.get("segments", [])):
            start, end = s.get("start"), s.get("end")
            if type(start) not in (int, float) or type(end) not in (int, float) or not all(map(math.isfinite, (start, end))):
                raise CLIError("Horodatages ASR invalides")
            start_ms, end_ms = round(start * 1000), round(end * 1000)
            text = s.get("text", "")
            if start_ms < previous_end or end_ms <= start_ms or not isinstance(text, str) or not text.strip():
                raise CLIError(f"Segment ASR {index} vide, chevauchant ou invalide")
            previous_end = end_ms
            segments.append({"id": str(index), "start_ms": start_ms, "end_ms": end_ms,
                             "arabic": text.strip(), "french": "", "version": 1})
        if not segments or (project["duration_ms"] and previous_end > project["duration_ms"]):
            raise CLIError("Transcription vide ou au-delà de la vidéo")
        audit = path.parent / "model_outputs"
        audit.mkdir(exist_ok=True)
        raw_path = audit / ("asr-" + uuid.uuid4().hex + ".json")
        with raw_path.open("xb") as handle:
            handle.write(args.file.read_bytes())
        project.update(segments=segments, stage="arabic", version=project["version"] + 1, arabic_version=1)
        write_json(path, project)
    print(f"{len(segments)} segments importés ; sortie ASR brute conservée dans {raw_path}")


def transcribe_command(args):
    path = project_file(args.project)
    # Generate outside the lock; import checks again before publishing anything.
    project = load_project(path, allow_empty=True)
    if project["segments"]:
        raise CLIError("Une transcription existe déjà ; utilisez un nouveau projet.")
    video = args.video or path.parent / "source.mp4"
    engine = args.engine
    if engine == "auto":
        engine = "mlx" if platform.system() == "Darwin" and platform.machine() == "arm64" else "faster-whisper"
    import tempfile
    with tempfile.TemporaryDirectory(prefix="tarjama-asr-") as temporary:
        audio = Path(temporary) / "audio.wav"
        run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(video.resolve()), "-vn", "-ar", "16000", "-ac", "1", str(audio)])
        try:
            if engine == "mlx":
                import mlx_whisper
                result = mlx_whisper.transcribe(str(audio), path_or_hf_repo=args.model or "mlx-community/whisper-large-v3-mlx",
                                               language="ar", task="transcribe", word_timestamps=False)
            else:
                from faster_whisper import WhisperModel
                model = WhisperModel(args.model or "large-v3", device="auto", compute_type="default")
                segments, _ = model.transcribe(str(audio), language="ar", vad_filter=True)
                result = {"segments": [{"start": s.start, "end": s.end, "text": s.text} for s in segments]}
        except ImportError as exc:
            raise CLIError("Whisper local absent. Lancez make cli-asr-setup puis utilisez CLI_PYTHON=.venv-cli-asr/bin/python.") from exc
        audit = path.parent / "model_outputs"
        audit.mkdir(exist_ok=True)
        response = audit / ("asr-generated-" + uuid.uuid4().hex + ".json")
        with response.open("x", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)
        # Persist even an invalid ASR result before the validator can reject it.
        import_asr_command(argparse.Namespace(project=path, file=response))


def status_command(args):
    path = project_file(args.project)
    with locked(path.parent):
        project = load_project(path, allow_empty=True)
        total = len(project["segments"])
        translated = sum(bool(s.get("french", "").strip()) for s in project["segments"])
        print(f"Projet : {path}")
        print(f"Étape : {project.get('stage', 'inconnue')} ; version : {project.get('version', 0)}")
        print(f"Segments : {total} ; traduits : {translated}/{total}")
        for kind in ("cleanup", "translation"):
            pending = path.parent / f"pending-{kind}.json"
            if pending.is_file():
                valid = read_json(pending).get("source_sha256") == source_digest(project)
                print(f"Prompt {kind} : {'prêt à importer' if valid else 'périmé, à régénérer'}")


def prompt_command(args):
    path = project_file(args.project)
    with locked(path.parent):
        project = load_project(path)
        selected = project["segments"]
        chunk = getattr(args, "chunk", None)
        if chunk is not None:
            minutes = args.chunk_minutes
            if not math.isfinite(minutes) or minutes <= 0 or chunk < 1:
                raise CLIError("Numéro de morceau et durée doivent être positifs")
            groups, current = [], []
            for segment in selected:
                if current and segment["end_ms"] - current[0]["start_ms"] > minutes * 60000:
                    groups.append(current)
                    current = []
                current.append(segment)
            if current:
                groups.append(current)
            if chunk > len(groups):
                raise CLIError(f"Ce projet contient {len(groups)} morceaux de {minutes:g} minutes")
            selected = groups[chunk - 1]
            print(f"Morceau {chunk}/{len(groups)} : {len(selected)} segments")
        text = prompt(dict(project, segments=selected), args.kind)
        output = path.parent / f"{args.kind}-prompt.md"
        atomic_write(output, text.encode())
        write_json(path.parent / f"pending-{args.kind}.json", {
            "source_sha256": source_digest(project), "segment_ids": [s["id"] for s in selected],
        })
    print(output)
    if not args.no_copy:
        clipboard(text=text)
        print("Prompt copié. Collez-le dans votre conversation ChatGPT, puis importez sa réponse.")


def import_command(args):
    path = project_file(args.project)
    content = clipboard() if args.clipboard else args.file.read_text(encoding="utf-8") if args.file else sys.stdin.read()
    with locked(path.parent):
        project = load_project(path)
        pending = read_json(path.parent / f"pending-{args.kind}.json")
        if pending.get("source_sha256") != source_digest(project):
            raise CLIError("Le projet a changé depuis le prompt. Régénérez-le avant d'importer une réponse.")
        updated = copy.deepcopy(project)
        wanted = set(pending["segment_ids"])
        selection = dict(project, segments=[s for s in project["segments"] if s["id"] in wanted])
        imported = {s["id"]: s for s in parse_response(content, selection, args.kind)}
        updated["segments"] = [imported.get(s["id"], s) for s in updated["segments"]]
        updated["version"] = project.get("version", 0) + 1
        updated["confirmed_review"] = 0
        if args.kind == "cleanup":
            for segment in updated["segments"]:
                segment["french"] = ""
            updated.update(arabic_version=project.get("arabic_version", 0) + 1, confirmed_arabic=0,
                           translation_source=0, stage="arabic")
        else:
            complete = all(s["french"].strip() for s in updated["segments"])
            updated.update(translation_source=project.get("arabic_version", 0), stage="review" if complete else "translating")
        # Explicit imports preserve the exact pre-import file, outside desktop snapshots.
        audit = path.parent / "imports"
        audit.mkdir(exist_ok=True)
        stamp = uuid.uuid4().hex
        with (audit / f"{stamp}-before.json").open("xb") as handle:
            handle.write(path.read_bytes())
        with (audit / f"{stamp}-response.md").open("x", encoding="utf-8") as handle:
            handle.write(content)
        write_json(path, updated)
    print(f"Réponse {args.kind} importée : {len(updated['segments'])} segments, timestamps inchangés.")


def desktop_import_command(args):
    from desktop_import import import_desktop
    project = import_desktop(args.source, args.output)
    print(f"Copie desktop : {project['title']} — {len(project['segments'])} segments traduits ; source inchangée.")


def export_command(args):
    path = project_file(args.project)
    project = load_project(path, translated=True)
    video = args.video or (path.parent / "source.mp4" if (path.parent / "source.mp4").exists() else None)
    result = export(project, video, args.output, backend=args.backend, model=args.model, speaker=args.speaker,
                    target_seconds=args.paragraph_seconds, target_chars=args.paragraph_chars,
                    clone_source=args.clone_source, reference_audio=args.reference_audio,
                    reference_start=args.reference_start, reference_seconds=args.reference_seconds,
                    bed_db=args.original_db, resume=args.resume, plan_only=args.plan_only, max_tokens=args.max_tokens,
                    voice_design=args.voice_design, voice_description=args.voice_description,
                    reference_text=args.reference_text, copy_video=args.copy_video, batch_size=args.batch_size,
                    engine=args.engine)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def voice_sample_command(args):
    from qwen_voice import QwenVoice, settings, FRENCH_FEMALE_DESIGN
    from tts_export import paragraphs, file_hash
    project = load_project(project_file(args.project), translated=True)
    text = paragraphs(project["segments"], target_ms=30000, target_chars=400)[0].text
    reference = getattr(args, "reference_audio", None)
    reference = reference.resolve() if reference else None
    text_path = getattr(args, "reference_text", None)
    reference_text = text_path.read_text(encoding="utf-8").strip() if text_path else None
    if text_path and (not reference or not reference_text or len(reference_text) > 16000):
        raise CLIError("--reference-text exige un extrait audio correspondant et un texte non vide (maximum 16000 caractères).")
    backend, model = settings(args.backend, args.model, bool(reference), voice_design=not reference)
    description = None if reference else args.voice_description or FRENCH_FEMALE_DESIGN
    reference_sha256 = file_hash(reference) if reference else None
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    with locked(output):
        write_json(output / "sample.json", {"model":model, "backend":backend, "language":"French",
                   "description":description, "text":text, "source_sha256":source_digest(project), "max_tokens":2048,
                   "reference_audio":str(reference) if reference else None, "reference_sha256":reference_sha256,
                   "reference_text":reference_text})
        print("Échantillon Qwen3-TTS Base 1.7B avec référence." if reference else "Échantillon Qwen3-TTS VoiceDesign 1.7B, sans clonage ni voix prédéfinie.", flush=True)
        kwargs = {"description":description}
        if reference_text is not None:
            kwargs["reference_text"] = reference_text
        voice = QwenVoice(backend, model, "", reference, 2048, **kwargs)
        voice.generate(text, output / "sample-generating.wav")
        (output / "sample-generating.wav").replace(output / "sample.wav")
    print(output / "sample.wav")


def preview_command(args):
    directory = args.export.resolve()
    seconds = getattr(args, "seconds", None)
    if seconds is not None and (not math.isfinite(seconds) or seconds <= 0):
        raise CLIError("La durée d'aperçu doit être positive et finie.")
    retimed_input = getattr(args, "retimed_input", False)
    metadata = []
    if getattr(args, "credits_file", None):
        credits = args.credits_file.read_text(encoding="utf-8").strip()
        if not credits or len(credits) > 16000:
            raise CLIError("Fichier de crédits vide ou trop long.")
        metadata = ["-metadata", "comment=" + credits]
    with locked(directory):
        name = "audit" if seconds is None else f"audit-first-{seconds:g}s"
        source = directory / ("retimed-source.mkv" if retimed_input else "export.mkv")
        output = directory / f"{name}.mp4"
        if not source.is_file() or output.exists():
            raise CLIError("Master absent ou audit.mp4 déjà présent ; aucun fichier final n'est écrasé.")
        # Retimed masters carry soft ASS cues too; burn them into the shareable
        # MP4. Old FFV1 exports already have subtitles burned into the picture.
        soft_subtitles = (directory / "timing.json").is_file() or (
            (directory / "plan.json").is_file() and read_json(directory / "plan.json").get("copy_video"))
        subtitle_filter = ["-vf", "ass=subtitles.ass"] if soft_subtitles else []
        inputs, audio_map = [], "0:a:0"
        if retimed_input:
            if not all((directory / p).is_file() for p in ("timing.json", "voice.wav", "mix.ffscript")):
                raise CLIError("Intermédiaires de recalage incomplets.")
            inputs = ["-i", "voice.wav", "-filter_complex_script", "mix.ffscript"]
            audio_map = "[mix]"
        duration = ["-t", str(seconds)] if seconds is not None else []
        run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source),
             *inputs, "-map", "0:v:0", "-map", audio_map, *subtitle_filter, *duration,
             "-c:v", "libx264", "-preset", "medium",
             "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k",
             "-movflags", "+faststart", "-map_metadata", "-1", *metadata, f"{name}.partial.mp4"], cwd=directory)
        (directory / f"{name}.partial.mp4").replace(output)
    print(output)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    sub = result.add_subparsers(dest="command", required=True)
    status = sub.add_parser("status", help="Résumé du projet sans afficher les sous-titres")
    status.add_argument("--project", type=Path, required=True)
    status.set_defaults(function=status_command)
    desktop = sub.add_parser("import-desktop", help="Copier un projet desktop traduit, sans modifier la bibliothèque")
    desktop.add_argument("--source", type=Path, required=True)
    desktop.add_argument("--output", type=Path, required=True)
    desktop.set_defaults(function=desktop_import_command)
    sample = sub.add_parser("voice-sample", help="Court essai Qwen VoiceDesign ou référence audio, sans réexporter la vidéo")
    sample.add_argument("--project", type=Path, required=True)
    sample.add_argument("--output", type=Path, required=True)
    sample.add_argument("--backend", choices=["auto", "mlx", "torch"], default="auto")
    sample.add_argument("--model")
    sample_source = sample.add_mutually_exclusive_group()
    sample_source.add_argument("--voice-description")
    sample_source.add_argument("--reference-audio", type=Path)
    sample.add_argument("--reference-text", type=Path, help="Transcription exacte de l'audio de référence pour le clonage contextualisé")
    sample.set_defaults(function=voice_sample_command)
    preview = sub.add_parser("preview", help="Copie MP4 de lecture haute qualité ; conserve le master sans perte")
    preview.add_argument("--export", type=Path, required=True)
    preview.add_argument("--credits-file", type=Path, help="Conserve attribution/licence dans les métadonnées du MP4")
    preview.add_argument("--seconds", type=float, help="Limite en secondes de vidéo doublée, pas de vidéo source")
    preview.add_argument("--retimed-input", action="store_true", help="Utilise image recalée + voix + mix existants, sans finaliser le master complet")
    preview.set_defaults(function=preview_command)
    from api_workflow import api_command
    api = sub.add_parser("api", help="Traitement payant avec le moteur API exact de l'app web")
    api.add_argument("kind", choices=["transcribe", "cleanup", "translation"])
    api.add_argument("--project", type=Path, required=True)
    api.add_argument("--video", type=Path)
    api.add_argument("--corpus", type=Path, default=Path(os.environ.get("REFERENCE_CORPUS_DIR", "data/reference_corpus/20260925-v2")))
    api.set_defaults(function=api_command)
    for name, function in (("projects", projects_command), ("fetch", fetch_command)):
        command = sub.add_parser(name, help="Lire son espace web" if name == "projects" else "Copier un projet web localement")
        command.add_argument("--url", default=os.environ.get("TARJAMA_URL"))
        command.add_argument("--cookies", type=Path, default=Path(os.environ["TARJAMA_COOKIES"]) if "TARJAMA_COOKIES" in os.environ else None)
        if name == "fetch":
            command.add_argument("--id", required=True)
            command.add_argument("--output", type=Path, required=True)
        command.set_defaults(function=function)
    create = sub.add_parser("create", help="Créer un projet local sans API, depuis un fichier ou un lien")
    source = create.add_mutually_exclusive_group(required=True)
    source.add_argument("--video", type=Path)
    source.add_argument("--link")
    create.add_argument("--output", type=Path, required=True)
    create.add_argument("--title")
    create.add_argument("--proxy", help="Proxy yt-dlp explicite, par exemple celui de WARP")
    create.set_defaults(function=create_command)
    asr = sub.add_parser("import-asr", help="Importer une sortie Whisper locale, sans appel API")
    asr.add_argument("--project", type=Path, required=True)
    asr.add_argument("--file", type=Path, required=True)
    asr.set_defaults(function=import_asr_command)
    transcribe = sub.add_parser("transcribe", help="Transcrire l'arabe avec Whisper local, sans API")
    transcribe.add_argument("--project", type=Path, required=True)
    transcribe.add_argument("--video", type=Path)
    transcribe.add_argument("--engine", choices=["auto", "mlx", "faster-whisper"], default="auto")
    transcribe.add_argument("--model")
    transcribe.set_defaults(function=transcribe_command)
    for name, function in (("prompt", prompt_command), ("import", import_command)):
        command = sub.add_parser(name, help="Préparer un prompt ChatGPT" if name == "prompt" else "Importer la réponse ChatGPT")
        command.add_argument("kind", choices=["cleanup", "translation"])
        command.add_argument("--project", type=Path, required=True)
        if name == "prompt":
            command.add_argument("--no-copy", action="store_true")
            command.add_argument("--chunk", type=int, help="Numéro du morceau à copier (à partir de 1)")
            command.add_argument("--chunk-minutes", type=float, default=20, help="Durée cible des morceaux manuels ChatGPT")
        else:
            source = command.add_mutually_exclusive_group()
            source.add_argument("--file", type=Path)
            source.add_argument("--clipboard", action="store_true")
        command.set_defaults(function=function)
    tts = sub.add_parser("export-tts", help="Voice-over français Qwen3-TTS ou Piper, paragraphes et master sans perte")
    tts.add_argument("--engine", choices=["qwen", "piper", "pocket"], default="qwen")
    tts.add_argument("--project", type=Path, required=True)
    tts.add_argument("--video", type=Path)
    tts.add_argument("--output", type=Path, required=True)
    tts.add_argument("--backend", choices=["auto", "mlx", "torch"], default="auto")
    tts.add_argument("--model", help="Identifiant Hugging Face ou répertoire local Qwen3-TTS 1.7B")
    tts.add_argument("--voice-description", help="Description de voix pour --voice-design (par défaut : narratrice française)")
    tts.add_argument("--reference-text", type=Path, help="Transcription exacte du fichier --reference-audio")
    tts.add_argument("--speaker", default="Ryan", help="Qwen : Ryan ou Serena ; Piper : Tom ou Pierre ; ignorée en clonage")
    tts.add_argument("--paragraph-seconds", type=float, default=60)
    tts.add_argument("--paragraph-chars", type=int, default=700)
    clone = tts.add_mutually_exclusive_group()
    clone.add_argument("--voice-design", action="store_true", help="Décrire une narratrice française avec VoiceDesign 1.7B, sans clonage")
    clone.add_argument("--clone-source", action="store_true", help="Extraire une référence de parole dans la vidéo (VAD)")
    clone.add_argument("--reference-audio", type=Path)
    tts.add_argument("--reference-start", type=float, help="Position de départ en secondes dans la vidéo")
    tts.add_argument("--reference-seconds", type=float, default=20)
    tts.add_argument("--original-db", type=float, default=-18, help="Atténuation de l'original pendant le français")
    tts.add_argument("--max-tokens", type=int, default=8192)
    tts.add_argument("--plan-only", action="store_true")
    tts.add_argument("--copy-video", action="store_true", help="Conserver la vidéo encodée originale, sans recompression ; sous-titres ASS séparés dans le MKV")
    tts.add_argument("--batch-size", type=int, choices=[1, 2, 3, 4], default=1, help="Paragraphes par lot GPU MLX ; exige audio et texte de référence")
    tts.add_argument("--resume", action="store_true")
    tts.set_defaults(function=export_command)
    return result


def main():
    args = parser().parse_args()
    try:
        args.function(args)
    except (CLIError, OSError, ValueError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrompu. TTS : reprendre avec --resume. API : relancer la même commande.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
