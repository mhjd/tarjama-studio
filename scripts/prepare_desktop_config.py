#!/usr/bin/env python3
"""Generate local desktop defaults from the repository .env file."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
OUTPUT = ROOT / "ui" / "electron" / "generated_defaults.ts"


def groq_api_key() -> str:
    environment_key = os.environ.get("GROQ_API_KEY", "").strip()
    if environment_key:
        return environment_key
    if not ENV_FILE.exists():
        return ""
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        match = re.match(r"\s*GROQ_API_KEY\s*=\s*(.*)\s*$", line)
        if match:
            return match.group(1).strip().strip("\"'")
    return ""


def main() -> None:
    OUTPUT.write_text(
        "// Generated locally from .env. Never commit this file.\n"
        f"export const BUNDLED_GROQ_API_KEY = {json.dumps(groq_api_key())};\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
