#!/bin/sh
set -eu
# Do not activate the pending research backend as a side effect of a UI release.
base_id=sha256:87e1b479643f97f62e6143f90db4248976ded28f55034b314a4669446bf66395
base_tag=tarjama-qualified-runtime:upload-fix
actual=$(docker image inspect --format '{{.Id}}' "$base_id")
[ "$actual" = "$base_id" ] || exit 1
docker tag "$base_id" "$base_tag"
docker build --platform linux/amd64 --build-arg "QUALIFIED_RUNTIME=$base_tag" -f web/deploy/Dockerfile.frontend -t tarjama-web:ui-review web
