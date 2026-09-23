package studio

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
)

type mediaOperation struct {
	Key, RemoteID        string
	Definition           operationDefinition
	Fingerprint          inputFingerprint
	Cached, Acknowledged bool
}

func mediaLease(ctx context.Context, tx pgx.Tx, p *Project, j Job) error {
	if p.Generation != j.Generation || (!strings.HasPrefix(j.Kind, "export_") && p.Version != j.SourceVersion) {
		return ErrConflict
	}
	if e := checkLease(ctx, tx, j); e != nil {
		return e
	}
	var attempt int
	if e := tx.QueryRow(ctx, "SELECT media_attempt FROM jobs WHERE id=$1", j.ID).Scan(&attempt); e != nil {
		return e
	}
	if attempt != j.MediaAttempt {
		return ErrConflict
	}
	return nil
}
func (m *IsolatedMedia) mutate(ctx context.Context, fn func(pgx.Tx) error) error {
	_, e := m.Store.Mutate(ctx, m.Job.Owner, m.Job.ProjectID, func(p *Project, tx pgx.Tx) error {
		if e := mediaLease(ctx, tx, p, m.Job); e != nil {
			return e
		}
		return fn(tx)
	})
	return e
}
func (m *IsolatedMedia) record(ctx context.Context, def operationDefinition) (mediaOperation, error) {
	op := mediaOperation{Key: def.Request.Key, Definition: def}
	b, e := json.Marshal(def)
	if e != nil {
		return op, e
	}
	e = m.mutate(ctx, func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `INSERT INTO media_operations(key,job_id,attempt,unit,definition) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, op.Key, m.Job.ID, m.Job.MediaAttempt, m.Unit, b)
		if e != nil {
			return e
		}
		var same, retired bool
		e = tx.QueryRow(ctx, `SELECT definition=$2::jsonb,remote_id,size,sha256,cached,acknowledged,retired FROM media_operations WHERE key=$1`, op.Key, b).Scan(&same, &op.RemoteID, &op.Fingerprint.Size, &op.Fingerprint.SHA256, &op.Cached, &op.Acknowledged, &retired)
		if e == nil && (!same || retired) {
			return errors.New("Définition d'opération modifiée ; réessai explicite requis")
		}
		return e
	})
	return op, e
}
func (m *IsolatedMedia) updateRemote(ctx context.Context, op *mediaOperation, id string) error {
	e := m.mutate(ctx, func(tx pgx.Tx) error {
		tag, e := tx.Exec(ctx, "UPDATE media_operations SET remote_id=$2,updated_at=now() WHERE key=$1 AND remote_id IN ('',$2)", op.Key, id)
		if e == nil && tag.RowsAffected() != 1 {
			return ErrConflict
		}
		return e
	})
	if e == nil {
		op.RemoteID = id
	}
	return e
}
func syncDirectory(path string) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return f.Sync()
}

// The advisory filesystem lock covers transfers across lease handover. Its path
// is server-generated and it is released by the kernel if the worker dies.
func lockOperation(ctx context.Context, dir string, wait bool) (*os.File, error) {
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	f, e := os.OpenFile(filepath.Join(dir, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	for {
		e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if e == nil {
			return f, nil
		}
		if !wait || (e != syscall.EWOULDBLOCK && e != syscall.EAGAIN) {
			f.Close()
			return nil, e
		}
		select {
		case <-ctx.Done():
			f.Close()
			return nil, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
}

// Reconcile is called even when the business queue is empty. Tombstones survive
// project deletion and remember cancellation/ACK intent across worker restarts.
// A worker shutdown or lease handover alone never cancels a valid remote job.
func (m *IsolatedMedia) Reconcile(ctx context.Context) error {
	rows, e := m.Store.DB.Query(ctx, `SELECT o.key,o.remote_id,o.definition,
 (j.id IS NULL OR j.media_attempt<>o.attempt OR j.state IN ('succeeded','failed','cancelled')
 OR (p.document->>'generation')::bigint<>j.generation
 OR (j.kind NOT LIKE 'export_%' AND (p.document->>'version')::bigint<>j.source_version)
 OR EXISTS(SELECT 1 FROM job_chunks c WHERE c.job_id=o.job_id AND c.ordinal=o.unit)) obsolete
 FROM media_operations o LEFT JOIN jobs j ON j.id=o.job_id LEFT JOIN projects p ON p.id=j.project_id
 WHERE NOT o.retired ORDER BY o.updated_at LIMIT 32`)
	if e != nil {
		return e
	}
	type pending struct {
		key, id  string
		def      operationDefinition
		obsolete bool
	}
	var work []pending
	for rows.Next() {
		var p pending
		var b []byte
		if e = rows.Scan(&p.key, &p.id, &b, &p.obsolete); e != nil {
			break
		}
		if e = json.Unmarshal(b, &p.def); e != nil {
			break
		}
		work = append(work, p)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return e
	}
	for _, p := range work {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		dir := m.operationDir(p.key)
		lock, e := lockOperation(ctx, dir, false)
		if e != nil {
			continue
		}
		func() {
			defer lock.Close()
			// Rotate the scan, including active operations, so older entries cannot starve cleanup.
			m.Store.DB.Exec(ctx, "UPDATE media_operations SET updated_at=now() WHERE key=$1", p.key)
			if !p.obsolete {
				return
			} // retain broker results until the local operation owns a durable copy
			if p.id == "" {
				op, e := m.Client.create(ctx, p.def.Request)
				if e != nil {
					return
				}
				p.id = op.ID
				if _, e = m.Store.DB.Exec(ctx, "UPDATE media_operations SET remote_id=$2 WHERE key=$1 AND remote_id=''", p.key, p.id); e != nil {
					return
				}
			}
			op, e := m.Client.status(ctx, p.id)
			if e != nil {
				return
			}
			if !remoteTerminal(op.State) {
				if e = m.Client.action(ctx, p.id, "cancel"); e != nil {
					return
				}
				// A 202 is only a request. Later reconciliations wait for an actual terminal state.
				return
			}
			if op.State != "acknowledged" {
				if e = m.Client.action(ctx, p.id, "ack"); e != nil {
					return
				}
			}
			// Keep the tiny lock inode; removing it while another process waits creates two locks.
			for _, name := range []string{"result", "partial"} {
				if e = os.Remove(filepath.Join(dir, name)); e != nil && !errors.Is(e, os.ErrNotExist) {
					return
				}
			}
			if e = syncDirectory(dir); e != nil {
				return
			}
			_, _ = m.Store.DB.Exec(ctx, "UPDATE media_operations SET acknowledged=true,retired=true WHERE key=$1", p.key)
		}()
	}
	return nil
}

func remoteTerminal(state string) bool {
	switch state {
	case "succeeded", "failed", "cancelled", "expired", "acknowledged":
		return true
	}
	return false
}
