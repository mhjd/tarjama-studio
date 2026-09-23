package studio

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"time"
)

func (s *Store) Claim(ctx context.Context) (Job, error) {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return Job{}, e
	}
	defer tx.Rollback(ctx)
	// Short lock serializes scheduling, never provider calls. One chunk per turn/user.
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(91372612)"); e != nil {
		return Job{}, e
	}
	var j Job
	var b []byte
	e = tx.QueryRow(ctx, `SELECT j.id,j.project_id,j.owner_id,j.kind,j.source_version,j.generation,j.input,j.attempts,j.media_attempt FROM jobs j JOIN users u ON u.id=j.owner_id
 WHERE ((j.state IN ('queued','waiting_provider') AND j.next_attempt_at<=now()) OR (j.state='running' AND j.lease_until<now()))
 AND NOT EXISTS(SELECT 1 FROM jobs a WHERE a.owner_id=j.owner_id AND a.state='running' AND a.lease_until>=now())
 ORDER BY u.last_served,j.updated_at,j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED`).Scan(&j.ID, &j.ProjectID, &j.Owner, &j.Kind, &j.SourceVersion, &j.Generation, &b, &j.Attempts, &j.MediaAttempt)
	if e != nil {
		return j, e
	}
	if e = json.Unmarshal(b, &j.Input); e != nil {
		return j, e
	}
	j.Lease = id()
	_, e = tx.Exec(ctx, "UPDATE jobs SET state='running',lease=$2,lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1", j.ID, j.Lease)
	if e == nil {
		_, e = tx.Exec(ctx, "UPDATE users SET last_served=now() WHERE id=$1", j.Owner)
	}
	if e != nil {
		return j, e
	}
	return j, tx.Commit(ctx)
}
func (s *Store) Heartbeat(ctx context.Context, j Job) bool {
	tag, e := s.DB.Exec(ctx, "UPDATE jobs SET lease_until=now()+interval '2 minutes' WHERE id=$1 AND lease=$2 AND state='running' AND lease_until>now()", j.ID, j.Lease)
	return e == nil && tag.RowsAffected() == 1
}
func checkLease(ctx context.Context, tx pgx.Tx, j Job) error {
	var valid bool
	e := tx.QueryRow(ctx, "SELECT state='running' AND lease=$2 AND lease_until>now() FROM jobs WHERE id=$1 FOR UPDATE", j.ID, j.Lease).Scan(&valid)
	if e != nil || !valid {
		return ErrConflict
	}
	return nil
}
func (s *Store) Chunk(ctx context.Context, j Job, ordinal int, result any, model, prompt string, progress int) error {
	_, e := s.Mutate(ctx, j.Owner, j.ProjectID, func(p *Project, tx pgx.Tx) error {
		if p.Generation != j.Generation || p.Version != j.SourceVersion {
			return ErrConflict
		}
		if e := checkLease(ctx, tx, j); e != nil {
			return e
		}
		b, e := json.Marshal(result)
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, `INSERT INTO job_chunks(job_id,ordinal,result,model,prompt_version,source_version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, j.ID, ordinal, b, model, prompt, j.SourceVersion)
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, "UPDATE jobs SET state='queued',lease='',lease_until=NULL,progress=$2,attempts=0,next_attempt_at=now(),updated_at=now(),message='' WHERE id=$1", j.ID, progress)
		return e
	})
	return e
}
func (s *Store) Chunks(ctx context.Context, j Job) ([]json.RawMessage, error) {
	rows, e := s.DB.Query(ctx, "SELECT result FROM job_chunks WHERE job_id=$1 ORDER BY ordinal", j.ID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	var out []json.RawMessage
	for rows.Next() {
		var b []byte
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
func (s *Store) Finish(ctx context.Context, j Job, apply func(*Project) error, next string) error {
	_, e := s.Mutate(ctx, j.Owner, j.ProjectID, func(p *Project, tx pgx.Tx) error {
		if p.Generation != j.Generation {
			return ErrConflict
		}
		if j.Kind[:min(len(j.Kind), 7)] != "export_" && p.Version != j.SourceVersion {
			return ErrConflict
		}
		if e := checkLease(ctx, tx, j); e != nil {
			return e
		}
		if e := apply(p); e != nil {
			return e
		}
		_, e := tx.Exec(ctx, "UPDATE jobs SET state='succeeded',progress=100,lease='',lease_until=NULL,message='',updated_at=now() WHERE id=$1", j.ID)
		if e == nil && next != "" {
			e = enqueue(ctx, tx, j.Owner, *p, next)
		}
		return e
	})
	return e
}
func (s *Store) Fail(ctx context.Context, j Job, err error) {
	state, message := "failed", "Le traitement a échoué. Réessayez ou contactez l’administrateur."
	delay := time.Duration(1<<min(j.Attempts, 8))*time.Second*10 + time.Duration(time.Now().UnixNano()%5000)*time.Millisecond
	var p *ProviderError
	if errors.As(err, &p) {
		message = p.Public
		if p.Temporary {
			state = "waiting_provider"
			if p.After > 0 {
				delay = p.After
			}
		}
	}
	if errors.Is(err, ErrConflict) || errors.Is(err, ErrMissing) {
		state = "cancelled"
		message = "Le projet a changé ; le résultat précédent a été écarté."
	}
	_, _ = s.DB.Exec(ctx, "UPDATE jobs SET state=$3,lease='',lease_until=NULL,message=$4,next_attempt_at=now()+$5::interval,attempts=attempts+1,updated_at=now() WHERE id=$1 AND lease=$2 AND state='running'", j.ID, j.Lease, state, message, delay.String())
}
func (s *Store) Cooldown(ctx context.Context, scope string) (time.Duration, error) {
	var until time.Time
	e := s.DB.QueryRow(ctx, "SELECT until_at FROM cooldowns WHERE scope=$1", scope).Scan(&until)
	if errors.Is(e, pgx.ErrNoRows) {
		return 0, nil
	}
	if e != nil {
		return 0, e
	}
	return max(0, time.Until(until)), nil
}
func (s *Store) SetCooldown(ctx context.Context, scope string, d time.Duration) error {
	_, e := s.DB.Exec(ctx, `INSERT INTO cooldowns(scope,until_at) VALUES($1,now()+$2::interval) ON CONFLICT(scope) DO UPDATE SET until_at=greatest(cooldowns.until_at,excluded.until_at)`, scope, d.String())
	return e
}
