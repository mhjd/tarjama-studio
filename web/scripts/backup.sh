#!/bin/sh
set -eu
if [ "${DEPLOY_AUTHORIZED:-}" != yes ]; then
  echo 'Opération sur installation vivante : attendre les instructions séparées.' >&2
  exit 1
fi
DEST=${1:?Specify BACKUP_DIR outside live storage}
mkdir -m 700 -p "$DEST"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DB="$DEST/database-$STAMP.dump"
FILES="$DEST/media-$STAMP.tar"
# Caller must pause writes/jobs for a consistent DB+media backup. Never stop automatically.
if [ "${WRITES_PAUSED:-}" != yes ]; then echo 'Pause writes/jobs before backing up; set WRITES_PAUSED=yes.' >&2; exit 1; fi
set -C
docker compose --env-file web/deploy/.env -f web/deploy/compose.yml exec -T db pg_dump -U postgres -Fc tarjama > "$DB"
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 10001:10001 -v tarjama-web_storage:/storage:ro debian:bookworm-slim tar -C /storage -cf - . > "$FILES"
sha256sum "$DB" "$FILES" > "$DEST/checksums-$STAMP.txt"
echo 'Backup copied. Store encrypted off-host; protect the encryption key separately.'
