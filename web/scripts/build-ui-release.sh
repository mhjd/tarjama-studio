#!/bin/sh
set -eu
# Do not activate the pending research backend as a side effect of a UI release.
base_id=sha256:a5abf964c6a22baf4255b7ef5eee7ef89315bae830b92dd4a950fad529490875
base_tag=tarjama-qualified-runtime:b69c700
actual=$(docker image inspect --format '{{.Id}}' "$base_id")
[ "$actual" = "$base_id" ] || exit 1
docker tag "$base_id" "$base_tag"
docker build --platform linux/amd64 --build-arg "QUALIFIED_RUNTIME=$base_tag" -f web/deploy/Dockerfile.frontend -t tarjama-web:ui-review web
