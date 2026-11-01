"""Small shortcuts over the existing CLI, never printing project content."""
import argparse
from pathlib import Path

from main import import_command, prompt_command, status_command
from workspace import CLIError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["status", "cleanup", "import-cleanup", "translation", "import-translation"])
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--file", type=Path, help="Réponse à importer ; sinon lit le presse-papiers")
    parser.add_argument("--chunk", type=int, help="Morceau de prompt, à partir de 1")
    parser.add_argument("--no-copy", action="store_true", help="Écrit le prompt sans modifier le presse-papiers")
    args = parser.parse_args()
    if args.action == "status":
        if args.file or args.chunk or args.no_copy:
            parser.error("status accepte seulement --project")
        status_command(args)
    elif args.action.startswith("import-"):
        if args.chunk or args.no_copy:
            parser.error("Un import accepte seulement --project et éventuellement --file")
        args.kind = args.action.removeprefix("import-")
        args.clipboard = args.file is None
        import_command(args)
    else:
        if args.file:
            parser.error("--file est réservé aux imports")
        args.kind = args.action
        args.chunk_minutes = 20
        prompt_command(args)


if __name__ == "__main__":
    import sys
    try:
        main()
    except (CLIError, OSError, ValueError) as exc:
        print(f"Erreur : {exc}", file=sys.stderr)
        raise SystemExit(1)
