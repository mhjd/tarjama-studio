#!/bin/sh
set -eu
KC_DATABASE_PASSWORD=$(cat /run/keycloak-db/password)
export KC_DATABASE_PASSWORD
: "${KC_DATABASE_PASSWORD:?identity DB role password required}"
# Runs only on the first start of this dedicated PostgreSQL volume.
psql -X -v ON_ERROR_STOP=1 --host /tmp --username postgres --dbname postgres <<'SQL'
\getenv role_password KC_DATABASE_PASSWORD
CREATE ROLE keycloak LOGIN PASSWORD :'role_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE keycloak OWNER keycloak;
REVOKE ALL ON DATABASE keycloak FROM PUBLIC;
SQL
