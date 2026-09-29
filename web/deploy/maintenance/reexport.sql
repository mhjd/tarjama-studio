-- Explicit owner-requested one-shot export; no login/session or project edits.
-- Run only through the registered job, after backup. No automatic rerun.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
CREATE TEMP TABLE requested_export_result(id text) ON COMMIT PRESERVE ROWS;
SELECT set_config('tarjama.project', :'project_id', true);
SELECT set_config('tarjama.url', :'expected_url', true);
DO $body$
DECLARE
 p projects%ROWTYPE;
 j jobs%ROWTYPE;
 export_kind text;
 target_version bigint;
 target_generation bigint;
 result_id text;
BEGIN
 SELECT * INTO STRICT p FROM projects WHERE id=current_setting('tarjama.project') FOR UPDATE;
 IF p.document->>'url' IS DISTINCT FROM current_setting('tarjama.url') THEN
  RAISE EXCEPTION 'Source does not match the owner request';
 END IF;
 IF COALESCE((p.document->>'archived')::boolean,false) OR p.document->>'stage' IS DISTINCT FROM 'ready'
 OR p.document->>'confirmed_review' IS DISTINCT FROM p.document->>'version' THEN
  RAISE EXCEPTION 'Project is not validated for export';
 END IF;
 IF EXISTS(SELECT 1 FROM jobs WHERE project_id=p.id AND state IN ('queued','running','waiting_provider')) THEN
  RAISE EXCEPTION 'Project already has an active treatment; no action taken';
 END IF;
 IF COALESCE(p.document->>'media','')='' AND COALESCE((p.document->>'media_uploaded')::boolean,false) THEN
  RAISE EXCEPTION 'Original file must be reimported';
 END IF;
 IF jsonb_array_length(p.document->'segments')=0 OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(p.document->'segments') s WHERE trim(COALESCE(s->>'french',''))=''
 ) THEN RAISE EXCEPTION 'Incomplete translation'; END IF;
 -- Keep the last French quality explicitly chosen for this project.
 SELECT kind INTO STRICT export_kind FROM jobs
 WHERE project_id=p.id AND owner_id=p.owner_id AND kind IN ('export_fr_low','export_fr_high')
 ORDER BY created_at DESC LIMIT 1;
 target_version:=(p.document->>'version')::bigint;
 target_generation:=(p.document->>'generation')::bigint;
 SELECT * INTO j FROM jobs WHERE project_id=p.id AND kind=export_kind
 AND source_version=target_version AND jobs.generation=target_generation FOR UPDATE;
 IF FOUND THEN
  IF j.state NOT IN ('succeeded','expired','failed','cancelled') THEN
   RAISE EXCEPTION 'Unexpected export state';
  END IF;
  UPDATE jobs SET state='queued',progress=0,message='',attempts=0,
   media_attempt=media_attempt+1,input=p.document,lease='',lease_until=NULL,
   next_attempt_at=now(),updated_at=now() WHERE id=j.id;
  result_id:=j.id;
 ELSE
  result_id:=md5(random()::text || clock_timestamp()::text || p.id);
  INSERT INTO jobs(id,project_id,owner_id,kind,source_version,generation,input)
   VALUES(result_id,p.id,p.owner_id,export_kind,target_version,target_generation,p.document);
 END IF;
 INSERT INTO requested_export_result VALUES(result_id);
 RAISE NOTICE 'Owner requested export queued: job=% quality=% version=% generation=%',result_id,export_kind,target_version,target_generation;
END
$body$;
COMMIT;
SELECT 'RESULT_JOB=' || id FROM requested_export_result;
