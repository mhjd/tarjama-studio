#!/bin/sh
set -eu
# Do not activate the pending research backend as a side effect of a UI release.
base_id=sha256:579f6c361955a85fd2f977972a676b795c814cc606325d4b60a03071141243c6
base_tag=tarjama-qualified-runtime:upload-fix
actual=$(docker image inspect --format '{{.Id}}' "$base_id")
[ "$actual" = "$base_id" ] || exit 1
docker tag "$base_id" "$base_tag"
docker build --platform linux/amd64 --build-arg "QUALIFIED_RUNTIME=$base_tag" -f web/deploy/Dockerfile.frontend -t tarjama-web:ui-review web
