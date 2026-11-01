"""Explicit real-model smoke test, with a synthetic video and no user media/API."""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import wave

from qwen_voice import QwenVoice, settings
from tts_export import export, run
from workspace import write_json

TEXT = (
    "Bonjour et bienvenue dans cette démonstration de narration documentaire. "
    "Nous allons prendre le temps de raconter une histoire en français, avec une voix masculine calme et naturelle. "
    "Le texte est lu en un seul paragraphe afin de conserver une intonation régulière et des transitions douces entre les phrases. "
    "La voix originale reste présente en arrière-plan, pendant que la traduction devient clairement audible au premier plan. "
    "Au début et à la fin du passage, nous laissons un peu de place à l'enregistrement original. "
    "Cet exemple utilise uniquement une vidéo synthétique et un modèle local, sans envoyer de contenu à un service de génération distant."
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--clone", action="store_true", help="Also download Base and test VAD/clone on our generated speech")
    args = parser.parse_args()
    directory = args.output.resolve()
    directory.mkdir(parents=True, exist_ok=False)
    backend, model = settings("auto", None, False)
    print(f"Test réel : {backend}, {model}", flush=True)
    voice = QwenVoice(backend, model, "Ryan", None, 2048)
    raw = directory / "generated-reference.wav"
    voice.generate(TEXT, raw)
    with wave.open(str(raw), "rb") as handle:
        duration = handle.getnframes() / handle.getframerate()
    video = directory / "source.mp4"
    run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", f"color=c=navy:s=640x360:r=24:d={duration + 2}",
         "-i", str(raw), "-af", "adelay=500|500,apad", "-t", str(duration + 2),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(video)])
    project = {"id": "local_tts_smoke", "title": "Voix synthétique de test, pas un locuteur réel", "version": 1,
               "duration_ms": round((duration + 2) * 1000), "segments": [{"id": "0", "start_ms": 500,
               "end_ms": round((duration + 1) * 1000), "arabic": "مرجع اصطناعي للاختبار فقط.", "french": TEXT, "version": 1}]}
    write_json(directory / "project.json", project)

    class PreparedVoice:
        def __init__(self, *unused):
            pass

        def generate(self, text, destination):
            shutil.copyfile(raw, destination)

    export(project, video, directory / "preset", backend=backend, model=model, voice_factory=PreparedVoice)
    # Do not keep both 1.7B variants resident for the optional cloning check.
    del voice
    if args.clone:
        export(project, video, directory / "clone", backend=backend, clone_source=True, max_tokens=2048)
    print(f"Test réel terminé : {directory}", flush=True)


if __name__ == "__main__":
    main()
