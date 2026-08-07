#!/usr/bin/env python3
from __future__ import annotations

import hashlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RELEASE_DIR = ROOT / "desktop-releases"
CHECKSUM_FILE = RELEASE_DIR / "SHA256SUMS"
ARTIFACT_PATTERNS = (
    "linux/Tarjama-Studio-*-linux-*.AppImage",
    "windows/Tarjama-Studio-*-windows-portable.exe",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    artifacts: list[Path] = []
    for pattern in ARTIFACT_PATTERNS:
        matches = sorted(RELEASE_DIR.glob(pattern))
        if len(matches) != 1:
            raise SystemExit(f"Expected one release artifact matching {pattern}, found {len(matches)}")
        artifacts.append(matches[0])

    lines = [f"{sha256(path)}  {path.relative_to(RELEASE_DIR).as_posix()}" for path in artifacts]
    CHECKSUM_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Release checksums updated: {CHECKSUM_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
