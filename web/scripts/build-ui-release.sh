#!/bin/sh
set -eu
# Do not activate the pending research backend as a side effect of a UI release.
base_id=sha256:cf5bdd756320423e6cced3429e0a49bfd715b0d3dffa1190fad89fa00635c098
base_tag=tarjama-qualified-runtime:asr-fix
actual=$(docker image inspect --format '{{.Id}}' "$base_id")
[ "$actual" = "$base_id" ] || exit 1
docker tag "$base_id" "$base_tag"
docker build --platform linux/amd64 --build-arg "QUALIFIED_RUNTIME=$base_tag" -f web/deploy/Dockerfile.frontend -t tarjama-web:ui-review web
