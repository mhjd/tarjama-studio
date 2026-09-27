#!/bin/bash
set -eu
# No image build/import or persistent runtime copy. Relative-path is a Keycloak
# BUILD option: re-augment only a disposable copy inside the test's bounded tmpfs.
cp -a /opt/keycloak /tmp/keycloak-runtime
export KC_DB=postgres KC_HEALTH_ENABLED=true
/bin/bash /tmp/keycloak-runtime/bin/kc.sh build
# The production entrypoint itself is tested; only its binary location changes.
sed 's@/opt/keycloak/bin/kc.sh@/bin/bash /tmp/keycloak-runtime/bin/kc.sh@' /qualification/entrypoint.sh > /tmp/source-start.sh
exec /bin/bash /tmp/source-start.sh
