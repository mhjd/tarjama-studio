#!/bin/sh
set -eu
export TEST_UID=$(id -u) TEST_GID=$(id -g)
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
python3 - <<'PY'
import json
from pathlib import Path
out=Path('web/.cache/keycloak-test')
out.mkdir(parents=True, exist_ok=True)
realm=json.loads(Path('web/deploy/keycloak/tarjama-realm.json').read_text())
# Only the test copy allows loopback HTTP and a non-authenticated local mailbox.
realm['sslRequired']='external'
realm['smtpServer'].update(auth='false', starttls='false')
(out/'tarjama-realm.json').write_text(json.dumps(realm))
(out/'tarjama-realm.json').chmod(0o644)
for directory,key in [('db','password'),('client','client_secret'),('mail','password'),('bootstrap','password')]:
    dest=out/'secrets'/directory
    dest.mkdir(parents=True, exist_ok=True)
    (dest/key).write_text('synthetic-only')
    # Public synthetic credentials, readable by the image UID 1000.
    dest.chmod(0o755)
    (dest/key).chmod(0o644)
PY
cleanup() {
  docker compose -f web/deploy/keycloak/compose.test.yml logs keycloak authdb > web/.cache/keycloak-test/services.log 2>&1 || true
  docker compose -f web/deploy/keycloak/compose.test.yml down
}
trap cleanup EXIT
trap 'exit 130' INT TERM
# No published ports; this project only contains disposable synthetic databases.
docker compose -f web/deploy/keycloak/compose.test.yml run --rm checks
# The identity database uses the same non-superuser initializer as the candidate.
# Verify an actual dump/restore, not just a realm JSON export.
docker compose -f web/deploy/keycloak/compose.test.yml exec -T authdb sh -s <<'CHECK'
set -eu
unset PGSERVICE PGSERVICEFILE
export PGHOST=127.0.0.1 PGPASSWORD=synthetic-only
pg_dump -U keycloak -Fc -f /tmp/identity.dump keycloak
createdb -U postgres restored_identity
pg_restore -U postgres --exit-on-error -d restored_identity /tmp/identity.dump
psql -U postgres -d restored_identity -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM realm WHERE name='tarjama') OR
    (SELECT count(*) FROM user_entity WHERE email IN ('alice@example.test','bob@example.test'))<>2 OR
    NOT EXISTS(SELECT 1 FROM credential WHERE type='password') OR
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='keycloak' AND (rolsuper OR rolcreatedb OR rolcreaterole))
 THEN RAISE EXCEPTION 'identity restore/role qualification failed'; END IF;
END $$;
SQL
dropdb -U postgres restored_identity
rm /tmp/identity.dump
printf 'Dedicated identity database dump/restore and restricted DB role: PASS\n'
CHECK
