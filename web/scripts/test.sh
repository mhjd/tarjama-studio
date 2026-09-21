#!/bin/sh
set -eu
# The fixed Compose project owns only synthetic test data. No production commands.
export TEST_UID=$(id -u) TEST_GID=$(id -g)
cleanup() { docker compose -f web/deploy/compose.test.yml down; }
trap cleanup EXIT
trap 'exit 130' INT TERM
docker compose -f web/deploy/compose.test.yml run --rm checks
# Test a PostgreSQL backup and restore with the server's matching-major tools.
docker compose -f web/deploy/compose.test.yml exec -T db sh -s <<'CHECK'
set -eu
pg_dump -U test -Fc -f /tmp/fixture.dump tarjama_test
createdb -U test restored_fixture
pg_restore -U test --no-owner --exit-on-error -d restored_fixture /tmp/fixture.dump
psql -U test -d restored_fixture -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS(SELECT 1 FROM projects) OR NOT EXISTS(SELECT 1 FROM jobs WHERE state='succeeded') THEN RAISE EXCEPTION 'restore lost fixtures'; END IF; END \$\$;"
dropdb -U test restored_fixture
rm /tmp/fixture.dump
CHECK
