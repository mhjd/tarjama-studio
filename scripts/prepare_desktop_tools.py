#!/usr/bin/env python3
from __future__ import annotations

import os
import hashlib
import platform
import shutil
import stat
import sys
import tarfile
import tempfile
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
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.unlink(missing_ok=True)
    shutil.copy2(source, temporary)
    make_executable(temporary)
    temporary.replace(target)


def download(url: str, target: Path, executable: bool = True, expected_sha256: str | None = None) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    print(f"Downloading {url}")
    with urllib.request.urlopen(url, timeout=120) as response:
        content = response.read(100 * 1024 * 1024 + 1)
    if len(content) > 100 * 1024 * 1024:
        raise SystemExit(f"Downloaded file is unexpectedly large: {url}")
    if expected_sha256 and hashlib.sha256(content).hexdigest() != expected_sha256:
        raise SystemExit(f"Checksum verification failed: {url}")
    tmp.write_bytes(content)
    tmp.replace(target)
    if executable:
        make_executable(target)


def download_file(url: str, target: Path, expected_sha256: str, maximum_bytes: int) -> None:
    digest = hashlib.sha256()
    written = 0
    with urllib.request.urlopen(url, timeout=120) as response, target.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            written += len(chunk)
            if written > maximum_bytes:
                raise SystemExit(f"Downloaded file is unexpectedly large: {url}")
            digest.update(chunk)
            output.write(chunk)
    if digest.hexdigest() != expected_sha256:
        raise SystemExit(f"Checksum verification failed: {url}")


def prepare_ytdlp(bin_dir: Path, key: str) -> None:
    extension = ".exe" if key.startswith("win32-") else ""
    target = bin_dir / f"yt-dlp{extension}"
    override = os.environ.get("TARJAMA_YTDLP")
    if override:
        copy_file(Path(override), target)
        return
    asset = (
        "yt-dlp_macos" if key.startswith("darwin-")
        else "yt-dlp.exe" if key.startswith("win32-")
        else "yt-dlp" if key.startswith("linux-")
        else None
    )
    if not asset:
        raise SystemExit(f"No yt-dlp package rule for {key}")
    base_url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download"
    with urllib.request.urlopen(f"{base_url}/SHA2-256SUMS", timeout=120) as response:
        checksum_lines = response.read().decode("utf-8").splitlines()
    checksum = None
    for line in checksum_lines:
        fields = line.split()
        if len(fields) >= 2 and fields[-1].lstrip("*") == asset:
            checksum = fields[0].lower()
            break
    if not checksum or len(checksum) != 64:
        raise SystemExit(f"Missing yt-dlp checksum for {asset}")
    download(f"{base_url}/{asset}", target, expected_sha256=checksum)


def prepare_ffmpeg(bin_dir: Path, key: str) -> None:
    extension = ".exe" if key.startswith("win32-") else ""
    target = bin_dir / f"ffmpeg{extension}"
    override = os.environ.get("TARJAMA_FFMPEG")
    if override:
        copy_file(Path(override), target)
        return

    if key == "linux-x64":
        asset = "ffmpeg-master-latest-linux64-gpl.tar.xz"
        base_url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
        with urllib.request.urlopen(f"{base_url}/checksums.sha256", timeout=120) as response:
            checksum_lines = response.read().decode("utf-8").splitlines()
        checksum = None
        for line in checksum_lines:
            fields = line.split()
            if len(fields) >= 2 and fields[-1].lstrip("*") == asset:
                checksum = fields[0].lower()
                break
        if not checksum or len(checksum) != 64:
            raise SystemExit(f"Missing FFmpeg checksum for {asset}")
        with tempfile.TemporaryDirectory(prefix="tarjama-ffmpeg-") as temp_dir:
            archive = Path(temp_dir) / asset
            download_file(f"{base_url}/{asset}", archive, checksum, 300 * 1024 * 1024)
            with tarfile.open(archive, "r:xz") as bundle:
                member = next(
                    (item for item in bundle.getmembers() if item.isfile() and item.name.endswith("/bin/ffmpeg")),
                    None,
                )
                if member is None:
                    raise SystemExit("FFmpeg archive does not contain bin/ffmpeg")
                source = bundle.extractfile(member)
                if source is None:
                    raise SystemExit("Unable to read FFmpeg from archive")
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("wb") as output:
                    shutil.copyfileobj(source, output)
                make_executable(target)
        return

    resolved = shutil.which("ffmpeg")
    if resolved:
        copy_file(Path(resolved), target)
        return

    raise SystemExit(
        "ffmpeg is missing. Install ffmpeg or set TARJAMA_FFMPEG=/path/to/ffmpeg before packaging."
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
