#!/bin/sh
set -eu
umask 077
export PGHOST=pv-authdb PGPORT=5432 PGDATABASE=keycloak PGUSER=keycloak PGCONNECT_TIMEOUT=3
PGPASSWORD=$(cat /run/keycloak-db/password)
export PGPASSWORD
for attempt in $(seq 1 30); do
  if psql -X -w -Atqc 'SELECT 1' >/dev/null 2>/tmp/authdb-ready.err; then break; fi
  sleep 2
done
psql -X -w -Atqc 'SELECT 1' >/dev/null
mkdir -p /identity-backups/dumps
out=/identity-backups/dumps/keycloak-$(date -u +%Y%m%dT%H%M%SZ).dump
# A failed dump is never published as a completed backup.
set -C
: > "$out.partial"
set +C
pg_dump -w -Fc > "$out.partial"
pg_restore --list "$out.partial" >/dev/null
mv "$out.partial" "$out"
sha256sum "$out"
printf 'Keycloak backup complete. Off-host copy and restore verification still required.\n'
