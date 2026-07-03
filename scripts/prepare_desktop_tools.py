#!/usr/bin/env python3
from __future__ import annotations

import os
import platform
import shutil
import stat
import sys
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "ui"
BIN_ROOT = UI / "desktop-bin"
FONT_ROOT = BIN_ROOT / "fonts"
ARABIC_FONT_URL = (
    "https://github.com/googlefonts/noto-fonts/raw/main/"
    "hinted/ttf/NotoNaskhArabic/NotoNaskhArabic-Regular.ttf"
)


def host_key() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64"
    if system == "darwin":
        return f"darwin-{arch}"
    if system == "windows":
        return f"win32-{arch}"
    if system == "linux":
        return f"linux-{arch}"
    raise SystemExit(f"Unsupported desktop platform: {system}-{machine}")


def make_executable(path: Path) -> None:
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def copy_file(source: Path, target: Path) -> None:
    if not source.exists():
        raise SystemExit(f"Missing source binary: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    make_executable(target)


def download(url: str, target: Path, executable: bool = True) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    print(f"Downloading {url}")
    with urllib.request.urlopen(url, timeout=120) as response:
        tmp.write_bytes(response.read())
    tmp.replace(target)
    if executable:
        make_executable(target)


def prepare_ytdlp(bin_dir: Path, key: str) -> None:
    extension = ".exe" if key.startswith("win32-") else ""
    target = bin_dir / f"yt-dlp{extension}"
    override = os.environ.get("ASHRAFENT_YTDLP")
    if override:
        copy_file(Path(override), target)
        return
    if key.startswith("darwin-"):
        download("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos", target)
        return
    if key.startswith("win32-"):
        download("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", target)
        return
    if key.startswith("linux-"):
        download("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp", target)
        return
    raise SystemExit(f"No yt-dlp package rule for {key}")


def prepare_ffmpeg(bin_dir: Path, key: str) -> None:
    extension = ".exe" if key.startswith("win32-") else ""
    target = bin_dir / f"ffmpeg{extension}"
    override = os.environ.get("ASHRAFENT_FFMPEG")
    if override:
        copy_file(Path(override), target)
        return

    mac_imageio = ROOT / ".venv/lib/python3.14/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1"
    if key == "darwin-arm64" and mac_imageio.exists():
        copy_file(mac_imageio, target)
        return

    resolved = shutil.which("ffmpeg")
    if resolved:
        copy_file(Path(resolved), target)
        return

    raise SystemExit(
        "ffmpeg is missing. Install ffmpeg or set ASHRAFENT_FFMPEG=/path/to/ffmpeg before packaging."
    )


def prepare_fonts() -> None:
    target = FONT_ROOT / "NotoNaskhArabic-Regular.ttf"
    if target.exists():
        return
    download(ARABIC_FONT_URL, target, executable=False)


def main() -> int:
    key = host_key()
    bin_dir = BIN_ROOT / key
    prepare_ytdlp(bin_dir, key)
    prepare_ffmpeg(bin_dir, key)
    prepare_fonts()
    print(f"Prepared desktop tools in {bin_dir.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
