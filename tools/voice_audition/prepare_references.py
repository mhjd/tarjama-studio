"""Download selected enhanced references and transcribe locally, text stays on disk."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
from urllib.request import Request, urlopen
import wave

from server import VALID, ROOT, connect
from benchmarks import KEY, voice_folder

sys.path.insert(0, str(ROOT / "web/cli"))
from workspace import read_json, write_json


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mark_prepared(database,name):
    with connect(database) as db:
        db.execute("UPDATE benchmarks SET status='pending' WHERE benchmark_id=? AND voice_path=? AND status='preparing'",(KEY,name))


def prepare(database, selection):
    voices = read_json(selection)["voices"]
    for index, voice in enumerate(voices):
        name = voice["path"]
        if not VALID.fullmatch(name):
            raise ValueError("Chemin de référence non autorisé.")
        directory = voice_folder(database, name)
        directory.mkdir(parents=True, exist_ok=True)
        with connect(database) as db:
            db.execute("UPDATE benchmarks SET status='preparing' WHERE benchmark_id=? AND voice_path=? AND status!='ready'", (KEY,name))
        audio, text_file = directory / "reference.wav", directory / "reference.txt"
        marker = directory / "reference.json"
        if marker.is_file() and audio.is_file() and text_file.is_file():
            metadata = read_json(marker)
            if metadata["audio_sha256"] != digest(audio) or metadata["text_sha256"] != digest(text_file):
                raise ValueError("Référence en cache modifiée ; aucun écrasement.")
            mark_prepared(database,name)
            continue
        print(f"Référence enhanced {index + 1}/{len(voices)} — {Path(name).stem}", flush=True)
        url = "https://huggingface.co/kyutai/tts-voices/resolve/main/" + name
        if not audio.exists():
            temporary = directory / "reference.downloading"
            with urlopen(Request(url, headers={"User-Agent":"Tarjama-Voice-Audition/1"}), timeout=90) as response, temporary.open("wb") as target:
                shutil.copyfileobj(response, target)
            with wave.open(str(temporary)) as wav:
                if not 0 < wav.getnframes() / wav.getframerate() <= 60:
                    raise ValueError("Durée de référence hors limites.")
            temporary.replace(audio)
        reused = False
        old_audio, old_text = None, None
        if Path(name).name.startswith("4193_"):
            old_audio = ROOT / "exports/references/cml-fr-4193/reference-enhanced.wav"
            old_text = old_audio.with_name("reference.txt")
        elif Path(name).name.startswith("4482_"):
            old_audio = ROOT / "exports/references/cml-fr-4482/reference.wav"
            old_text = old_audio.with_name("reference.txt")
        if old_audio and old_audio.is_file() and old_text.is_file() and digest(old_audio) == digest(audio):
            transcript = old_text.read_text().strip()
            reused = True
        else:
            import mlx_whisper
            result = mlx_whisper.transcribe(str(audio), path_or_hf_repo="mlx-community/whisper-base-mlx",
                language="fr", temperature=0, condition_on_previous_text=False, verbose=None)
            transcript = result["text"].strip()
            write_json(directory / "reference-asr.json", result)
        if not transcript:
            raise ValueError("Transcription de référence vide.")
        text_file.write_text(transcript + "\n", encoding="utf-8")
        write_json(marker, {"source":url,"audio_sha256":digest(audio),"text_sha256":digest(text_file),
                           "transcript":"local_whisper_base_fr_not_independently_verified", "reused_transcript":reused})
        mark_prepared(database,name)


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database",type=Path,required=True)
    parser.add_argument("--selection",type=Path,required=True)
    args=parser.parse_args()
    prepare(args.database,args.selection)
