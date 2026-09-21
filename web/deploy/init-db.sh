#!/bin/sh
set -eu
# psql variable quoting, never shell interpolation inside SQL.
APP_DB_PASSWORD=$(cat /run/secrets/app_db_password)
export APP_DB_PASSWORD
psql --username postgres --dbname tarjama --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password APP_DB_PASSWORD
CREATE ROLE tarjama LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE tarjama OWNER TO tarjama;
GRANT USAGE, CREATE ON SCHEMA public TO tarjama;
SQL
unset APP_DB_PASSWORD
