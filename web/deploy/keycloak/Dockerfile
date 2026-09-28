FROM quay.io/keycloak/keycloak:26.7.4@sha256:82a77884f3af238beab1e7afd63b5f530e1b5c0590bd7aa60b40a40463e29b2c AS builder
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_HTTP_MANAGEMENT_HEALTH_ENABLED=false KC_HTTP_RELATIVE_PATH=/
RUN /opt/keycloak/bin/kc.sh build
FROM quay.io/keycloak/keycloak:26.7.4@sha256:82a77884f3af238beab1e7afd63b5f530e1b5c0590bd7aa60b40a40463e29b2c
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY --chown=1000:1000 entrypoint.sh /opt/keycloak/bin/tarjama-start
COPY --chown=1000:1000 themes/ /opt/keycloak/themes/
USER 1000:1000
RUN rm -rf /opt/keycloak/data && ln -s /tmp/keycloak-data /opt/keycloak/data
ENTRYPOINT ["/bin/bash", "/opt/keycloak/bin/tarjama-start"]
