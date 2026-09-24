#!/usr/bin/env python3
"""Stage the qualified runtime plus qualified upload/ASR fixes and safe diagnostics.

The pending translation/research backend is deliberately excluded from this release.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
cache = root / "web/.cache"
cache.mkdir(exist_ok=True)
stage = Path(tempfile.mkdtemp(prefix="upload-release-", dir=cache))


def archive(revision, path):
    data = subprocess.check_output(["git", "archive", revision, path], cwd=root)
    subprocess.run(["tar", "-x", "-C", str(stage)], input=data, check=True)


archive("b69c700", "web/backend")
archive("HEAD", "web/frontend")
# Explicitly reviewed additions/fixes; do not copy the pending backend wholesale.
for name in ["api.go", "studio_test.go", "isolated_client.go", "isolated_test.go", "asr_test.go", "text_retry_test.go", "routes_test.go"]:
    relative = Path("web/backend/internal/studio") / name
    shutil.copy2(root / relative, stage / relative)
# 8b25d68 is the pre-incident source; its candidate prompt version remains excluded.
worker_patch = subprocess.check_output([
    "git", "diff", "8b25d68", "--", "web/backend/internal/studio/worker.go"
], cwd=root)
# The only pre-incident worker difference was the candidate prompt version call.
# Normalize patch context and new lines to the qualified prompt version.
worker_patch = worker_patch.replace(b"PromptVersion(j.Kind)", b'j.Kind+"-v1"')
if worker_patch:
    subprocess.run(["git", "apply", "--directory", str(stage.relative_to(root))],
                   input=worker_patch, cwd=root, check=True)
# Apply only the response-handling patch, leaving candidate research excluded.
provider_patch = subprocess.check_output([
    "git", "diff", "05c4c8c", "--", "web/backend/internal/studio/providers.go"
], cwd=root)
if provider_patch:
    subprocess.run(["git", "apply", "--directory", str(stage.relative_to(root))],
                   input=provider_patch, cwd=root, check=True)
shutil.copytree(root / "web/backend/cmd/media-diagnostic", stage / "web/backend/cmd/media-diagnostic")
# Include frontend edits without dependencies, build output or runtime data.
shutil.copytree(root / "web/frontend/src", stage / "web/frontend/src", dirs_exist_ok=True)
shutil.copy2(root / "web/deploy/Dockerfile", stage / "web/Dockerfile")
with (stage / "web/Dockerfile").open("a") as dockerfile:
    dockerfile.write("""
FROM backend AS diagnostic-build
RUN CGO_ENABLED=0 go build -trimpath -o /media-diagnostic ./cmd/media-diagnostic
FROM api AS upload-release
COPY --from=diagnostic-build /media-diagnostic /usr/local/bin/media-diagnostic
""")
(cache / "upload-release-path").write_text(str(stage))
print(stage)
