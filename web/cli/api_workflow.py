"""Optional paid API workflow using the exact Go web provider implementation."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import subprocess
import uuid

from workspace import CLIError, ROOT, load_project, locked, project_file, read_json, source_digest, write_json
from tts_export import file_hash, probe, run


def engine_fingerprint(corpus: Path) -> str:
    digest = hashlib.sha256()
    backend = ROOT / "web/backend"
    files = sorted((backend / "internal").rglob("*.go"))
    files += sorted((backend / "internal/studio/prompts").glob("*.txt"))
    files += [backend / "cmd/local-api/main.go", backend / "go.mod", backend / "go.sum"]
    for path in files:
        digest.update(str(path.relative_to(backend)).encode())
        digest.update(path.read_bytes())
    for name in ("manifest.json", "entries.jsonl"):
        digest.update((corpus / name).read_bytes())
    return digest.hexdigest()


def bridge(request: dict, audit: Path):
    binary = ROOT / "web/.cache/local-api"
    if not binary.is_file():
        raise CLIError("Pont API absent : lancer make cli-api-build.")
    try:
        result = subprocess.run([str(binary)], input=json.dumps(request), text=True,
                                capture_output=True, timeout=420)
    except subprocess.TimeoutExpired as exc:
        raise CLIError("Délai API dépassé. Relancez la même commande pour reprendre les morceaux terminés.") from exc
    try:
        response = json.loads(result.stdout)
    except ValueError as exc:
        raise CLIError("Le moteur API n'a pas renvoyé de JSON ; vérifiez make cli-api-build.") from exc
    # Raw responses/audits survive validation failures; credentials never enter JSON.
    write_json(audit / ("attempt-" + uuid.uuid4().hex + ".json"), response)
    if result.returncode or response.get("error"):
        raise CLIError(response.get("error", "Échec du moteur API. La progression est conservée."))
    return response["result"]


def api_command(args):
    path = project_file(args.project)
    corpus = args.corpus.resolve()
    with locked(path.parent):
        project = load_project(path, allow_empty=args.kind == "transcribe")
        if args.kind == "transcribe" and project["segments"]:
            raise CLIError("Une transcription existe déjà ; créez un nouveau projet.")
        # Changing code, corpus, source text or media cannot silently reuse paid results.
        fingerprint = engine_fingerprint(corpus)
        video = (args.video or path.parent / "source.mp4").resolve()
        identity = {"kind":args.kind, "source":source_digest(project), "engine":fingerprint,
                    "binary":file_hash(ROOT / "web/.cache/local-api")}
        if args.kind == "transcribe":
            identity["video"] = file_hash(video)
        token = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        audit = path.parent / "api_runs" / token
        audit.mkdir(parents=True, exist_ok=True)
        write_json(audit / "identity.json", identity)
        updated = copy.deepcopy(project)
        if args.kind == "transcribe":
            duration_ms = probe(video)["duration_ms"]
            chunks, start, index = [], 0.0, 0
            while start < duration_ms / 1000:
                seconds = min(600, duration_ms / 1000 - start)
                cached = audit / f"{index:04d}.json"
                if cached.is_file():
                    chunk = read_json(cached)
                else:
                    print(f"Groq {index + 1} : {start:.1f}–{start + seconds:.1f} s", flush=True)
                    audio = audit / f"{index:04d}.flac"
                    run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(start), "-i", str(video),
                         "-t", str(seconds), "-vn", "-ar", "16000", "-ac", "1", "-c:a", "flac", str(audio)])
                    chunk = bridge({"kind":"audio", "audio":str(audio), "start":start, "duration":seconds}, audit)
                    # Validate with the web boundary logic before accepting this checkpoint.
                    bridge({"kind":"merge-asr", "asr_chunks":[chunk], "total_duration":duration_ms}, audit)
                    write_json(cached, chunk)
                chunks.append(chunk)
                if start + seconds >= duration_ms / 1000 - .01:
                    break
                start += max(30, seconds - 20)
                index += 1
            updated["segments"] = bridge({"kind":"merge-asr", "asr_chunks":chunks, "total_duration":duration_ms}, audit)
            updated.update(stage="arabic", arabic_version=1)
        else:
            plan = bridge({"kind":"plan", "segments":project["segments"]}, audit)
            write_json(audit / "plan.json", plan)
            imported = {}
            for index, segments in enumerate(plan["chunks"]):
                cached = audit / f"{index:04d}.json"
                if cached.is_file():
                    result = read_json(cached)
                    bridge({"kind":"validate-text", "segments":segments, "text_result":result}, audit)
                else:
                    print(f"{args.kind} API {index + 1}/{len(plan['chunks'])} — {plan['model']} (medium)", flush=True)
                    result = bridge({"kind":"cleanup" if args.kind == "cleanup" else "translate",
                                     "segments":project["segments"], "chunk":index, "corpus":str(corpus)}, audit)
                    write_json(cached, result)
                rows = result["segments"]
                if [r["id"] for r in rows] != [s["id"] for s in segments] or any(not r["text"].strip() for r in rows):
                    raise CLIError("Checkpoint API mal aligné ; aucun texte importé.")
                imported.update({r["id"]:r["text"] for r in rows})
            field = "arabic" if args.kind == "cleanup" else "french"
            for segment in updated["segments"]:
                segment[field] = imported[segment["id"]]
                segment["version"] = segment.get("version", 0) + 1
                if args.kind == "cleanup":
                    segment["french"] = ""
            if args.kind == "cleanup":
                updated.update(stage="arabic", arabic_version=project.get("arabic_version", 0) + 1,
                               confirmed_arabic=0, translation_source=0)
            else:
                updated.update(stage="review", translation_source=project.get("arabic_version", 0))
        updated.update(version=project.get("version", 0) + 1, confirmed_review=0)
        # Validate before atomically publishing; keep the exact previous state.
        candidate = audit / "candidate.json"
        write_json(candidate, updated)
        load_project(candidate)
        write_json(audit / "before.json", project)
        write_json(path, updated)
        print(f"{args.kind} terminé : {len(updated['segments'])} segments. Audit : {audit}")
