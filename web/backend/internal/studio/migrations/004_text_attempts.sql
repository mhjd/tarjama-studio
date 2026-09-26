-- Additive: keep old jobs/chunks intact; explicit retries start a new budget epoch.
ALTER TABLE jobs ADD COLUMN text_failures integer NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN text_epoch integer NOT NULL DEFAULT 0;
CREATE TABLE text_attempts (
 id text PRIMARY KEY,
 job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 epoch integer NOT NULL,
 ordinal integer NOT NULL,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 consumes_budget boolean NOT NULL DEFAULT true,
 code text NOT NULL DEFAULT 'interrupted_or_running',
 diagnostics jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX text_attempts_budget ON text_attempts(job_id, epoch, ordinal);
