-- Additive: existing Authelia sessions remain valid until expiry or explicit migration.
ALTER TABLE sessions ADD COLUMN oidc_sid text NOT NULL DEFAULT '';
CREATE INDEX sessions_oidc_sid ON sessions(oidc_sid) WHERE oidc_sid <> '';
CREATE TABLE oidc_logout_events (
 issuer text NOT NULL, jti text NOT NULL, sid text NOT NULL, subject text NOT NULL,
 issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(issuer,jti)
);
CREATE INDEX oidc_logout_events_expiry ON oidc_logout_events(expires_at);
