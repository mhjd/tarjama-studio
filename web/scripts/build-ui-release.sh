#!/bin/sh
set -eu
# Do not activate the pending research backend as a side effect of a UI release.
base_id=sha256:eae32c6c0cc660ce63bf885e98ecbf73f006f2756b550962f933824b435c46c9
base_tag=tarjama-qualified-runtime:routes
actual=$(docker image inspect --format '{{.Id}}' "$base_id")
[ "$actual" = "$base_id" ] || exit 1
docker tag "$base_id" "$base_tag"
docker build --platform linux/amd64 --build-arg "QUALIFIED_RUNTIME=$base_tag" -f web/deploy/Dockerfile.frontend -t tarjama-web:ui-review web
