ALTER TABLE jobs ADD COLUMN media_attempt integer NOT NULL DEFAULT 0;
-- Deliberately no cascading FK: cancellation must survive project deletion.
CREATE TABLE media_operations (
 key text PRIMARY KEY,
 job_id text NOT NULL,
 attempt integer NOT NULL,
 unit integer NOT NULL,
 definition jsonb NOT NULL,
 remote_id text NOT NULL DEFAULT '',
 size bigint NOT NULL DEFAULT 0,
 sha256 text NOT NULL DEFAULT '',
 cached boolean NOT NULL DEFAULT false,
 acknowledged boolean NOT NULL DEFAULT false,
 retired boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_operations_pending ON media_operations(retired,updated_at);
