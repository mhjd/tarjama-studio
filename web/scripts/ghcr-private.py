#!/usr/bin/env python3
"""Ensure the two GHCR packages are private before publishing application images."""
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

PACKAGES = ("tarjama-web", "tarjama-media")
SOURCE = "https://github.com/mhjd/tarjama-studio"


def visibility(package, token):
    request = urllib.request.Request(
        f"https://api.github.com/users/mhjd/packages/container/{package}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)["visibility"]
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise RuntimeError(f"Package metadata refused (HTTP {error.code}); check Actions package permissions") from None
    except (OSError, ValueError, KeyError):
        raise RuntimeError("Package visibility could not be verified") from None


def ensure_private(package, token, commit, bootstrap=False):
    state = visibility(package, token)
    if state is None and bootstrap:
        # A 404 can mean absent OR inaccessible. Only an empty image may be
        # pushed in this case. Application content remains blocked until the
        # authenticated API positively confirms private visibility.
        ref = f"ghcr.io/mhjd/{package}:bootstrap-{commit}"
        dockerfile = f'FROM scratch\nLABEL org.opencontainers.image.source="{SOURCE}"\n'
        subprocess.run(["docker", "build", "--platform", "linux/amd64", "--tag", ref, "-"],
                       input=dockerfile.encode(), check=True)
        subprocess.run(["docker", "push", ref], check=True)
        state = visibility(package, token)
    if state != "private":
        raise RuntimeError(f"{package}: private visibility not confirmed; grant this repository Actions access to the private package")
    print(f"{package}: private visibility confirmed")


def main():
    bootstrap = sys.argv[1:] == ["--bootstrap"]
    if sys.argv[1:] not in ([], ["--bootstrap"]):
        raise RuntimeError("Usage: ghcr-private.py [--bootstrap]")
    if os.environ.get("GITHUB_REPOSITORY") != "mhjd/tarjama-studio" or os.environ.get("GITHUB_REF") != "refs/heads/web-vps":
        raise RuntimeError("Publication is restricted to mhjd/tarjama-studio, web-vps")
    commit, token = os.environ.get("GITHUB_SHA", ""), os.environ.get("GH_TOKEN", "")
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or not token:
        raise RuntimeError("GitHub Actions commit and GITHUB_TOKEN required")
    for package in PACKAGES:
        ensure_private(package, token, commit, bootstrap)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
