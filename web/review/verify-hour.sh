#!/bin/sh
set -eu
export PGHOST=pv-db PGPORT=5432 PGDATABASE=tarjama PGUSER=tarjama PGCONNECT_TIMEOUT=3
export PGOPTIONS='-c default_transaction_read_only=on'
export PGPASSWORD="$(cat /run/db/app_db_password)"
for attempt in $(seq 1 30); do
  if psql -X -w -Atqc 'SELECT 1' >/dev/null 2>/dev/null; then break; fi
  sleep 2
done
psql -X -w -At --set ON_ERROR_STOP=on -f /qualification/verify-hour.sql
