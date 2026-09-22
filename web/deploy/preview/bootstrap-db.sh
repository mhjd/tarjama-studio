#!/bin/sh
set -eu
# Explicit job; no secrets in command arguments or output.
export PGCONNECT_TIMEOUT=2
attempt=0
until psql -X -w --set ON_ERROR_STOP=1 -Atqc 'SELECT 1' >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 45 ]; then
    echo 'PostgreSQL unavailable after bounded startup wait' >&2
    exit 1
  fi
  sleep 2
done
psql -X -w --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password APP_DB_PASSWORD
BEGIN;
SELECT pg_advisory_xact_lock(91372611);
SELECT 'CREATE ROLE tarjama LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tarjama')
\gexec
ALTER ROLE tarjama LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DATABASE tarjama OWNER TO tarjama;
GRANT USAGE, CREATE ON SCHEMA public TO tarjama;
COMMIT;
SQL
