#!/bin/sh
set -eu
export PGHOST=pv-db PGPORT=5432 PGDATABASE=tarjama PGUSER=tarjama PGCONNECT_TIMEOUT=3
PGPASSWORD=$(cat /run/db/app_db_password)
export PGPASSWORD
for attempt in $(seq 1 30); do
  if psql -X -w -Atqc 'SELECT 1' >/dev/null 2>/tmp/ready.err; then break; fi
  sleep 2
done
before=$(psql -X -w -At -v ON_ERROR_STOP=1 -v project_id="$REQUESTED_PROJECT" <<'SQL'
SELECT md5((document->'segments')::text) FROM projects WHERE id=:'project_id';
SQL
)
result=$(psql -X -w -At -v ON_ERROR_STOP=1 -v project_id="$REQUESTED_PROJECT" -v expected_url="$EXPECTED_SOURCE_URL" -f /configuration/reexport.sql)
printf '%s\n' "$result"
job=$(printf '%s\n' "$result" | sed -n 's/^RESULT_JOB=//p')
case "$job" in ''|*[!a-f0-9]*) exit 1;; esac
for attempt in $(seq 1 90); do
  state=$(psql -X -w -At -v ON_ERROR_STOP=1 -v job_id="$job" <<'SQL'
SELECT state FROM jobs WHERE id=:'job_id';
SQL
)
  printf 'Export %s: %s\n' "$job" "$state"
  case "$state" in
    succeeded)
      after=$(psql -X -w -At -v ON_ERROR_STOP=1 -v project_id="$REQUESTED_PROJECT" <<'SQL'
SELECT md5((document->'segments')::text) FROM projects WHERE id=:'project_id';
SQL
)
      test "$before" = "$after"
      test -s "/storage/$job.mp4"
      printf 'Export complete; subtitle texts unchanged.\n'
      wc -c "/storage/$job.mp4"
      exit 0;;
    failed|cancelled|expired|'') exit 1;;
  esac
  sleep 30
done
printf 'Monitoring deadline reached; no automatic rerun or cancellation.\n'
exit 124
