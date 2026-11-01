"""Export an existing five-minute sample and concatenate its unretimed takes."""
import argparse
from pathlib import Path
import sys
import wave

from tts_export import export, file_hash, paragraphs
from workspace import CLIError, load_project, project_file


def natural_audio(directory, count):
    target = directory / "natural.wav"
    with wave.open(str(target), "wb") as dest:
        expected = None
        for index in range(count):
            with wave.open(str(directory / f"{index:04d}-raw.wav"), "rb") as source:
                params = (source.getnchannels(), source.getsampwidth(), source.getframerate())
                if expected is None:
                    expected = params
                    dest.setparams((*params, 0, "NONE", "not compressed"))
                if params != expected:
                    raise CLIError("Formats audio différents entre les prises Pocket.")
                if index:
                    dest.writeframes(b"\0" * (round(params[2] * .2) * params[0] * params[1]))
                while data := source.readframes(65536):
                    dest.writeframes(data)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    path = project_file(args.project).resolve()
    before = file_hash(path)
    project = load_project(path, translated=True)
    result = export(project, path.parent / "source.mp4", args.output, engine="pocket", speaker="estelle",
                    model="french_24l", copy_video=True, resume=args.resume)
    natural = natural_audio(args.output, len(paragraphs(project["segments"])))
    if before != file_hash(path):
        raise CLIError("Le projet source a changé pendant l'essai.")
    print(f"Vidéo : {result['output']}\nVoix non recalée : {natural}")


if __name__ == "__main__":
    try:
        main()
    except (CLIError, OSError, ValueError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1)
