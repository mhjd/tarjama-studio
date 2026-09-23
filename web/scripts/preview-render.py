#!/usr/bin/env python3
"""Render public configuration only; never read secrets or activate a preview."""
import argparse
import ipaddress
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
FIELDS = {"API_IMAGE", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_EGRESS", "WARP_HTTP_PROXY", "WARP_EGRESS"}


def render(values, phase="stopped"):
    if set(values) != FIELDS or any(not isinstance(v, str) or not v or "REQUIRED_" in v for v in values.values()):
        raise ValueError("Provide exactly the public fields in inputs.example.json, without placeholders or secret values")
    for field, component in [("API_IMAGE", "web")]:
        if not re.fullmatch(r"preview\.local/atelier/" + component + r"@sha256:[a-f0-9]{64}", values[field]):
            raise ValueError(f"{field}: exact registered local manifest reference required (not a local image ID)")
    issuer = urlsplit(values["OIDC_ISSUER"])
    if issuer.scheme != "https" or not issuer.hostname or issuer.username or issuer.password or issuer.query or issuer.fragment:
        raise ValueError("OIDC_ISSUER must be the real HTTPS discovery issuer")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,160}", values["OIDC_CLIENT_ID"]):
        raise ValueError("OIDC_CLIENT_ID: invalid public identifier")
    for key in ("OIDC_EGRESS", "WARP_EGRESS"):
        if not re.fullmatch(r"[a-z][a-z0-9-]{0,62}", values[key]):
            raise ValueError(f"{key}: registered capability/profile name required")
    if values["WARP_EGRESS"] == "public-web":
        raise ValueError("WARP requires a targeted administrator capability, not public-web")
    host, port = values["WARP_HTTP_PROXY"].rsplit(":", 1)
    ipaddress.IPv4Address(host)
    if not port.isdigit() or not 1 <= int(port) <= 65535:
        raise ValueError("WARP_HTTP_PROXY: administrator-provided IPv4:port required")
    text = (ROOT / "web/deploy/preview/deploy.template.yml").read_text()
    # Public proxy settings can already be pinned in the reviewed recipe.
    text = re.sub(r'(?m)^(\s+WARP_HTTP_PROXY: ).+$', r'\1REQUIRED_WARP_HTTP_PROXY', text)
    text = re.sub(r'(?ms)(^  egress:\n.*?^    egress: )\[[^\]\n]*\]',
                  r'\1[REQUIRED_WARP_EGRESS]', text)
    # The reviewed recipe may already pin a previous local build. A new render
    # must use the supplied digests, never silently keep that previous build.
    for field, component in [("API_IMAGE", "web")]:
        text = re.sub(r'(?m)^(\s+image: )"?preview\.local/atelier/' + component + r'@sha256:[a-f0-9]{64}"?$',
                      lambda match: match[1] + "REQUIRED_" + field, text)
    replacements = dict(values)
    replacements["BOOTSTRAP_SCRIPT"] = (ROOT / "web/deploy/preview/bootstrap-db.sh").read_text()
    text = re.sub(r"\bREQUIRED_([A-Z_]+)\b", lambda m: json.dumps(replacements[m[1]], ensure_ascii=False), text)
    if phase == "bootstrap":
        text = text.replace("  db:\n    enabled: false", "  db:\n    enabled: true")
    elif phase == "active":
        text = text.replace("enabled: false", "enabled: true")
    elif phase != "stopped":
        raise ValueError("Unknown preparation phase")
    if phase != "stopped":
        text = text.replace("# All services remain stopped; jobs require a separate, explicit activation.",
                            f"# Phase: {phase}. Applying this recipe starts services; jobs remain explicit.")
    if len(text.encode()) > 65536:
        raise ValueError("Recipe exceeds broker size limit")
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--phase", choices=["stopped", "bootstrap", "active"], default="stopped")
    args = parser.parse_args()
    try:
        text = render(json.loads(Path(args.inputs).read_text()), args.phase)
        # Fail if the destination exists: preserve a previously reviewed recipe.
        with Path(args.output).open("x") as dest:
            dest.write(text)
    except (ValueError, OSError, KeyError) as err:
        parser.exit(1, f"Recipe not prepared: {err}\n")
    print(f"Prepared {args.output} ({args.phase}); no deployment performed")


if __name__ == "__main__":
    main()
