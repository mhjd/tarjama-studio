#!/bin/bash
set -eu
# No secret in image, arguments, generated recipe or logs.
: "${KC_HOSTNAME:?public identity URL required}"
: "${KC_DB_URL:?dedicated identity database required}"
: "${TARJAMA_PUBLIC_ORIGIN:?application origin required}"
: "${TARJAMA_BACKCHANNEL_URL:?application logout endpoint required}"
KC_DB_PASSWORD="$(cat /run/keycloak-db/password)"
TARJAMA_OIDC_SECRET="$(cat /run/keycloak-client/client_secret)"
TARJAMA_SMTP_PASSWORD="$(cat /run/keycloak-mail/password)"
export KC_DB_PASSWORD TARJAMA_OIDC_SECRET TARJAMA_SMTP_PASSWORD
: "${KC_DB_PASSWORD:?database password required}"
: "${TARJAMA_OIDC_SECRET:?OIDC client secret required}"
# Bootstrap administrator is temporary. Remove this mount after creating the
# permanent named administrator; no permanent admin credential goes to Tarjama.
if [ -f /run/keycloak-bootstrap/password ]; then
  export KC_BOOTSTRAP_ADMIN_USERNAME=bootstrap-tarjama
  KC_BOOTSTRAP_ADMIN_PASSWORD="$(cat /run/keycloak-bootstrap/password)"
  export KC_BOOTSTRAP_ADMIN_PASSWORD
fi
mkdir -p /tmp/keycloak-data/import
cp /configuration/tarjama-realm.json /tmp/keycloak-data/import/tarjama-realm.json
exec /opt/keycloak/bin/kc.sh start --optimized --import-realm --cache=local "$@"
