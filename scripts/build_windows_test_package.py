#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI_DIR = ROOT / "ui"
PACKAGE_JSON = UI_DIR / "package.json"
PACKAGE_LOCK = UI_DIR / "package-lock.json"
WINDOWS_PACKAGE_DIR = ROOT / "windows-test-package"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.write_text(f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n", encoding="utf-8")


def next_patch_version(version: str) -> str:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version)
    if not match:
        raise SystemExit(f"Unsupported version format: {version}")
    major, minor, patch = (int(part) for part in match.groups())
    return f"{major}.{minor}.{patch + 1}"


def update_app_version(version: str) -> None:
    package = read_json(PACKAGE_JSON)
    package["version"] = version
    write_json(PACKAGE_JSON, package)

    lock = read_json(PACKAGE_LOCK)
    lock["version"] = version
    lock.setdefault("packages", {}).setdefault("", {})["version"] = version
    write_json(PACKAGE_LOCK, lock)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def update_readme(version: str) -> None:
    readme = WINDOWS_PACKAGE_DIR / "README.md"
    target_name = f"Tarjama-Studio-{version}-windows-portable.exe"
    content = readme.read_text(encoding="utf-8")
    content = re.sub(r"Tarjama-Studio-\d+\.\d+\.\d+-windows-portable\.exe", target_name, content)
    readme.write_text(content, encoding="utf-8")


def replace_package_exe(version: str) -> Path:
    source = UI_DIR / "release" / f"Tarjama Studio {version}.exe"
    if not source.exists():
        raise SystemExit(f"Build artifact missing: {source}")

    WINDOWS_PACKAGE_DIR.mkdir(parents=True, exist_ok=True)
    destination = WINDOWS_PACKAGE_DIR / f"Tarjama-Studio-{version}-windows-portable.exe"

    for old_exe in WINDOWS_PACKAGE_DIR.glob("Tarjama-Studio-*-windows-portable.exe"):
        if old_exe != destination:
            old_exe.unlink()

    shutil.copy2(source, destination)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Build and refresh the Windows test package.")
    parser.add_argument("--version", help="Explicit version to build. Defaults to the next patch version.")
    parser.add_argument("--skip-build", action="store_true", help="Only refresh package files from an existing build artifact.")
    args = parser.parse_args()

    package = read_json(PACKAGE_JSON)
    version = args.version or next_patch_version(str(package["version"]))

    update_app_version(version)
    if not args.skip_build:
        subprocess.run(["make", "desktop-win-portable"], cwd=ROOT, check=True)

    packaged_exe = replace_package_exe(version)
    update_readme(version)
    print(f"Windows package ready: {packaged_exe.relative_to(ROOT)}")
    print(f"SHA-256: {sha256(packaged_exe)}")


if __name__ == "__main__":
    main()
