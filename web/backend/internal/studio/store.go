package studio

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema embed.FS

type Store struct{ DB *pgxpool.Pool }

func Open(ctx context.Context, dsn string) (*Store, error) {
	p, e := pgxpool.New(ctx, dsn)
	if e != nil {
		return nil, e
	}
	if e = p.Ping(ctx); e != nil {
		p.Close()
		return nil, e
	}
	return &Store{p}, nil
}
func (s *Store) Migrate(ctx context.Context) error {
	b, _ := schema.ReadFile("schema.sql")
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(91372610)"); e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, string(b)); e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) User(ctx context.Context, issuer, subject string) (string, error) {
	var uid string
	e := s.DB.QueryRow(ctx, `INSERT INTO users(id,issuer,subject) VALUES($1,$2,$3) ON CONFLICT(issuer,subject) DO UPDATE SET issuer=excluded.issuer RETURNING id`, id(), issuer, subject).Scan(&uid)
	return uid, e
}
func (s *Store) Get(ctx context.Context, owner, pid string) (Project, error) {
	var b []byte
	var p Project
	e := s.DB.QueryRow(ctx, "SELECT document FROM projects WHERE id=$1 AND owner_id=$2", pid, owner).Scan(&b)
	if errors.Is(e, pgx.ErrNoRows) {
		return p, ErrMissing
	}
	if e != nil {
		return p, e
	}
	e = json.Unmarshal(b, &p)
	return p, e
}
func (s *Store) List(ctx context.Context, owner string) ([]Project, error) {
	rows, e := s.DB.Query(ctx, "SELECT document FROM projects WHERE owner_id=$1 ORDER BY created_at DESC", owner)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Project{}
	for rows.Next() {
		var b []byte
		var p Project
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, &p); e != nil {
			return nil, e
		}
		p.Segments = nil
		out = append(out, p)
	}
	return out, rows.Err()
}
func (s *Store) Create(ctx context.Context, owner string, p Project) error {
	b, e := json.Marshal(p)
	if e != nil {
		return e
	}
	_, e = s.DB.Exec(ctx, "INSERT INTO projects(id,owner_id,document) VALUES($1,$2,$3)", p.ID, owner, b)
	return e
}
func (s *Store) Mutate(ctx context.Context, owner, pid string, fn func(*Project, pgx.Tx) error) (Project, error) {
	var p Project
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return p, e
	}
	defer tx.Rollback(ctx)
	var b []byte
	e = tx.QueryRow(ctx, "SELECT document FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE", pid, owner).Scan(&b)
	if errors.Is(e, pgx.ErrNoRows) {
		return p, ErrMissing
	}
	if e != nil {
		return p, e
	}
	if e = json.Unmarshal(b, &p); e != nil {
		return p, e
	}
	if e = fn(&p, tx); e != nil {
		return p, e
	}
	b, e = json.Marshal(p)
	if e != nil {
		return p, e
	}
	_, e = tx.Exec(ctx, "UPDATE projects SET document=$1 WHERE id=$2", b, pid)
	if e != nil {
		return p, e
	}
	return p, tx.Commit(ctx)
}
func enqueue(ctx context.Context, tx pgx.Tx, owner string, p Project, kind string) error {
	b, e := json.Marshal(p)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO jobs(id,project_id,owner_id,kind,source_version,generation,input) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(project_id,kind,source_version,generation) DO NOTHING`, id(), p.ID, owner, kind, p.Version, p.Generation, b)
	return e
}
func (s *Store) Jobs(ctx context.Context, owner, pid string) ([]Job, error) {
	rows, e := s.DB.Query(ctx, `SELECT id,kind,state,source_version,generation,progress,message,next_attempt_at::text FROM jobs WHERE owner_id=$1 AND project_id=$2 ORDER BY created_at`, owner, pid)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Job{}
	for rows.Next() {
		j := Job{ProjectID: pid}
		if e = rows.Scan(&j.ID, &j.Kind, &j.State, &j.SourceVersion, &j.Generation, &j.Progress, &j.Message, &j.NextAttempt); e != nil {
			return nil, e
		}
		out = append(out, j)
	}
	return out, rows.Err()
}
