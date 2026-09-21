CREATE TABLE IF NOT EXISTS users (
 id text PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
 last_served timestamptz NOT NULL DEFAULT 'epoch', UNIQUE(issuer, subject)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
 csrf text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS login_flows (
 state_hash text PRIMARY KEY, nonce text NOT NULL, verifier text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
 id text PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id),
 document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);
CREATE TABLE IF NOT EXISTS credentials (
 owner_id text NOT NULL REFERENCES users(id), provider text NOT NULL CHECK(provider IN ('gemini','groq')),
 ciphertext bytea NOT NULL, version integer NOT NULL DEFAULT 1, PRIMARY KEY(owner_id,provider)
);
CREATE TABLE IF NOT EXISTS jobs (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 owner_id text NOT NULL REFERENCES users(id), kind text NOT NULL,
 source_version bigint NOT NULL, generation bigint NOT NULL, input jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued', next_attempt_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0, lease text NOT NULL DEFAULT '', lease_until timestamptz,
 progress integer NOT NULL DEFAULT 0, message text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(project_id,kind,source_version,generation)
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,next_attempt_at);
CREATE TABLE IF NOT EXISTS job_chunks (
 job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, ordinal integer NOT NULL,
 result jsonb NOT NULL, model text NOT NULL, prompt_version text NOT NULL,
 source_version bigint NOT NULL, PRIMARY KEY(job_id,ordinal)
);
CREATE TABLE IF NOT EXISTS cooldowns (
 scope text PRIMARY KEY, until_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS imports (
 owner_id text NOT NULL REFERENCES users(id), digest text NOT NULL,
 project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, PRIMARY KEY(owner_id,digest)
);
