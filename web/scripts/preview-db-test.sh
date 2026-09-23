#!/bin/sh
set -eu
# Synthetic, isolated data only. No broker, host ports or persistent volumes.
name="tarjama-preview-check-$$"
postgres='docker.io/library/postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73'
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    docker inspect --format '{{.Name}} {{json .State}}' "$name-db" "$name-migrate" 2>/dev/null || true
    docker logs --tail 25 "$name-db" 2>&1 || true
    docker logs --tail 10 "$name-migrate" 2>&1 || true
  fi
  docker rm -f "$name-migrate" "$name-db" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM
docker network create --internal "$name" >/dev/null
# Intentionally begin before the database exists; migration must await it.
docker run -d --name "$name-migrate" --network "$name" --read-only \
  --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges:true \
  --cpus .25 --memory 256m --pids-limit 64 --tmpfs /tmp:size=64m \
  -e 'DATABASE_URL=postgres://tarjama:preview-test-only@pv-db:5432/tarjama?sslmode=disable' \
  tarjama-web:review migrate >/dev/null
docker run -d --name "$name-db" --network "$name" --network-alias pv-db \
  --read-only --user 70:70 --cap-drop ALL --security-opt no-new-privileges:true \
  --cpus .75 --memory 768m --pids-limit 100 \
  --tmpfs /tmp:size=64m --tmpfs /data:size=256m,uid=70,gid=70,mode=0700 \
  -e PGDATA=/data/pgdata -e PGSERVICE=preview-init -e PGSERVICEFILE=/configuration/pg_service.conf \
  -e POSTGRES_DB=tarjama -e POSTGRES_PASSWORD=admin-fixture-only \
  -e 'POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=peer' \
  -v "$(pwd)/web/deploy/preview/bootstrap-db.sh:/configuration/bootstrap-db.sh:ro" \
  -v "$(pwd)/web/deploy/preview/pg_service.conf:/configuration/pg_service.conf:ro" \
  "$postgres" postgres -c unix_socket_directories=/tmp -c max_connections=40 -c shared_buffers=128MB >/dev/null
for iteration in 1 2; do
  docker exec -e PGHOST=127.0.0.1 -e PGUSER=postgres -e PGDATABASE=tarjama \
    -e PGPASSWORD=admin-fixture-only -e APP_DB_PASSWORD=preview-test-only \
    "$name-db" env -u PGSERVICE -u PGSERVICEFILE sh /configuration/bootstrap-db.sh
done
code=$(timeout 280 docker wait "$name-migrate")
if [ "$code" != 0 ]; then
  docker logs "$name-migrate"
  exit 1
fi
docker exec -e PGHOST=127.0.0.1 -e PGUSER=tarjama -e PGDATABASE=tarjama \
  -e PGPASSWORD=preview-test-only "$name-db" \
  env -u PGSERVICE -u PGSERVICEFILE psql -X -w --set ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF (SELECT count(*) FROM schema_migrations) <> 2 OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'invalid migration or excessive privileges'; END IF; END \$\$;"
echo 'Preview DB: restricted initialization, repeated bootstrap and delayed migration passed'
