-- Qualification schema only. The connection enforces read-only transactions.
SET search_path = ui_review_tenmin_hour2;
DO $$
DECLARE p jsonb;
BEGIN
 IF (SELECT count(*) FROM projects) <> 1 THEN RAISE EXCEPTION 'expected one qualification project'; END IF;
 SELECT document INTO p FROM projects;
 IF p->>'url' <> 'https://www.youtube.com/watch?v=7TLnx8DIu4c'
    OR p->>'stage' <> 'ready'
    OR jsonb_array_length(p->'segments')=0
    OR (p->>'duration_ms')::bigint NOT BETWEEN 3590000 AND 3630000
    OR (p->>'confirmed_review')::bigint <> (p->>'version')::bigint
 THEN RAISE EXCEPTION 'project not fully validated'; END IF;
 IF EXISTS (SELECT 1 FROM jobs WHERE state <> 'succeeded')
    OR (SELECT count(*) FROM jobs) <> 5
 THEN RAISE EXCEPTION 'expected five completed jobs'; END IF;
 IF EXISTS (
  SELECT 1 FROM (
   SELECT s, lag((s->>'end_ms')::bigint) OVER (ORDER BY n) previous_end
   FROM jsonb_array_elements(p->'segments') WITH ORDINALITY a(s,n)
  ) x WHERE coalesce(s->>'arabic','')='' OR coalesce(s->>'french','')=''
   OR (s->>'end_ms')::bigint <= (s->>'start_ms')::bigint
   OR (s->>'start_ms')::bigint < 0
   OR (s->>'end_ms')::bigint > (p->>'duration_ms')::bigint
   OR (s->>'start_ms')::bigint < previous_end
 ) THEN RAISE EXCEPTION 'invalid final subtitle text or timing'; END IF;
 IF (SELECT count(DISTINCT s->>'id') FROM jsonb_array_elements(p->'segments') s)
    <> jsonb_array_length(p->'segments')
 THEN RAISE EXCEPTION 'duplicate subtitle IDs'; END IF;
 IF EXISTS (
  SELECT 1 FROM job_chunks c JOIN jobs j ON j.id=c.job_id
  CROSS JOIN LATERAL (
   SELECT max((s->>'end_ms')::bigint)-min((s->>'start_ms')::bigint) span_ms
   FROM jsonb_array_elements(j.input->'segments') s
   WHERE s->>'id' IN (SELECT r->>'id' FROM jsonb_array_elements(c.result->'segments') r)
  ) bounds
  WHERE j.kind IN ('cleanup','translate') AND jsonb_array_length(c.result->'segments')>1
   AND bounds.span_ms>600000
 ) THEN RAISE EXCEPTION 'text chunk exceeds ten minutes'; END IF;
END $$;
SELECT jsonb_build_object('stage',document->>'stage','duration_ms',document->'duration_ms',
 'width',document->'width','height',document->'height','segments',jsonb_array_length(document->'segments'))
FROM projects;
SELECT jsonb_build_object('kind',kind,'state',state,'attempts',attempts,'progress',progress)
FROM jobs ORDER BY created_at;
SELECT jsonb_build_object('kind',j.kind,'ordinal',c.ordinal,'model',c.model,
 'segments',jsonb_array_length(c.result->'segments'),
 'span_ms',(SELECT max((s->>'end_ms')::bigint)-min((s->>'start_ms')::bigint)
  FROM jsonb_array_elements(j.input->'segments') s
  WHERE s->>'id' IN (SELECT r->>'id' FROM jsonb_array_elements(c.result->'segments') r)))
FROM job_chunks c JOIN jobs j ON j.id=c.job_id WHERE j.kind IN ('cleanup','translate')
ORDER BY j.kind,c.ordinal;
SELECT jsonb_build_object('asr_chunks',count(*),'max_duration_seconds',max((c.result->>'duration')::numeric))
FROM job_chunks c JOIN jobs j ON j.id=c.job_id WHERE j.kind='transcribe';
