#!/usr/bin/env python3
"""Stage the qualified runtime plus the upload fix and safe broker diagnostics.

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
# These files matched the qualified base before this change. Keep the list explicit.
for name in ["api.go", "studio_test.go", "isolated_client.go", "isolated_test.go"]:
    relative = Path("web/backend/internal/studio") / name
    shutil.copy2(root / relative, stage / relative)
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
