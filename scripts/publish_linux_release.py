#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI_DIR = ROOT / "ui"
PACKAGE_JSON = UI_DIR / "package.json"
LINUX_RELEASE_DIR = ROOT / "desktop-releases" / "linux"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and publish the Linux AppImage.")
    parser.add_argument("--skip-build", action="store_true", help="Publish an existing AppImage from ui/release.")
    args = parser.parse_args()

    version = str(json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))["version"])
    if not args.skip_build:
        subprocess.run(["make", "desktop-linux-appimage"], cwd=ROOT, check=True)

    candidates = sorted((UI_DIR / "release").glob(f"Tarjama-Studio-{version}-linux-*.AppImage"))
    if len(candidates) != 1:
        raise SystemExit(f"Expected one AppImage for {version}, found {len(candidates)}")

    LINUX_RELEASE_DIR.mkdir(parents=True, exist_ok=True)
    destination = LINUX_RELEASE_DIR / candidates[0].name
    for old_appimage in LINUX_RELEASE_DIR.glob("Tarjama-Studio-*-linux-*.AppImage"):
        if old_appimage != destination:
            old_appimage.unlink()
    shutil.copy2(candidates[0], destination)
    destination.chmod(destination.stat().st_mode | 0o111)

    print(f"Linux release ready: {destination.relative_to(ROOT)}")
    print(f"SHA-256: {sha256(destination)}")


if __name__ == "__main__":
    main()
