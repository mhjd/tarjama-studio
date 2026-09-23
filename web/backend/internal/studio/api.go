package studio

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const MaxMediaBytes int64 = 1024 * 1024 * 1024
const MaxStorageBytes int64 = 12 * 1024 * 1024 * 1024

type API struct {
	Store  *Store
	Config Config
	Auth   *Auth
}

func jsonOut(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024*1024))
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return errors.New("Requête JSON invalide")
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("Requête JSON invalide")
	}
	return nil
}
func apiError(w http.ResponseWriter, e error) {
	var dbError *pgconn.PgError
	if errors.As(e, &dbError) || pgconn.SafeToRetry(e) || errors.Is(e, context.DeadlineExceeded) {
		http.Error(w, "Service temporairement indisponible", 503)
		return
	}
	status := 400
	if errors.Is(e, ErrMissing) {
		status = 404
	}
	if errors.Is(e, ErrConflict) {
		status = 409
	}
	http.Error(w, e.Error(), status)
}
func storagePath(root, name string) string {
	if !safeID.MatchString(strings.TrimSuffix(name, ".mp4")) || strings.Contains(name, "/") {
		panic("invalid private object")
	}
	return filepath.Join(root, name)
}
func (a *API) Routes() http.Handler {
	m := http.NewServeMux()
	protected := http.NewServeMux()
	a.Auth.Routes(m)
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	m.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if a.Store.Ready(r.Context()) != nil {
			http.Error(w, "Indisponible", 503)
			return
		}
		w.WriteHeader(204)
	})
	m.HandleFunc("GET /api/config", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, map[string]any{"development": a.Config.Mode != "production"})
	})
	protected.HandleFunc("GET /api/session", func(w http.ResponseWriter, r *http.Request) {
		jsonOut(w, map[string]string{"id": who(r).User, "csrf": who(r).CSRF})
	})
	protected.HandleFunc("POST /api/logout", func(w http.ResponseWriter, r *http.Request) {
		c, _ := r.Cookie("tarjama_session")
		_, e := a.Store.DB.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", hash(c.Value))
		if e != nil {
			http.Error(w, "Déconnexion impossible", 503)
			return
		}
		a.Auth.cookie(w, "tarjama_session", "", -1)
		w.WriteHeader(204)
	})
	protected.HandleFunc("GET /api/projects", func(w http.ResponseWriter, r *http.Request) {
		p, e := a.Store.List(r.Context(), who(r).User)
		if e != nil {
			http.Error(w, "Lecture impossible", 503)
			return
		}
		jsonOut(w, p)
	})
	protected.HandleFunc("POST /api/projects", a.create)
	protected.HandleFunc("GET /api/projects/{id}", func(w http.ResponseWriter, r *http.Request) {
		p, e := a.Store.Get(r.Context(), who(r).User, r.PathValue("id"))
		if e != nil {
			apiError(w, e)
			return
		}
		jobs, e := a.Store.Jobs(r.Context(), who(r).User, p.ID)
		if e != nil {
			http.Error(w, "Lecture impossible", 503)
			return
		}
		jsonOut(w, map[string]any{"project": p, "jobs": jobs})
	})
	protected.HandleFunc("PATCH /api/projects/{id}/segments/{segment}", a.edit)
	protected.HandleFunc("PATCH /api/projects/{id}", a.rename)
	protected.HandleFunc("POST /api/projects/{id}/advance", a.advance)
	protected.HandleFunc("POST /api/projects/{id}/exports", a.export)
	protected.HandleFunc("PUT /api/projects/{id}/media", a.upload)
	protected.HandleFunc("GET /api/projects/{id}/media", a.media)
	protected.HandleFunc("GET /api/projects/{id}/exports/{job}", a.downloadExport)
	protected.HandleFunc("POST /api/projects/{id}/jobs/{job}/cancel", a.cancel)
	protected.HandleFunc("POST /api/projects/{id}/jobs/{job}/retry", a.retry)
	protected.HandleFunc("DELETE /api/projects/{id}", a.delete)
	protected.HandleFunc("GET /api/credentials", a.keyStatus)
	protected.HandleFunc("PUT /api/credentials/{provider}", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Key string `json:"key"`
		}
		e := decode(w, r, &b)
		if e == nil {
			e = a.Store.SetKey(r.Context(), a.Config, who(r).User, r.PathValue("provider"), b.Key)
		}
		if e != nil {
			apiError(w, e)
			return
		}
		w.WriteHeader(204)
	})
	protected.HandleFunc("DELETE /api/credentials/{provider}", func(w http.ResponseWriter, r *http.Request) {
		if e := a.Store.SetKey(r.Context(), a.Config, who(r).User, r.PathValue("provider"), ""); e != nil {
			apiError(w, e)
			return
		}
		w.WriteHeader(204)
	})
	m.Handle("/api/", a.Auth.Protect(protected))
	m.Handle("/", http.FileServer(http.Dir(a.Config.Frontend)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		m.ServeHTTP(w, r)
	})
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Title string `json:"title"`
		URL   string `json:"url"`
	}
	if e := decode(w, r, &b); e != nil {
		apiError(w, e)
		return
	}
	b.Title = strings.TrimSpace(b.Title)
	if b.Title == "" || len(b.Title) > 300 {
		apiError(w, errors.New("Titre requis (300 caractères maximum)"))
		return
	}
	if b.URL != "" {
		var e error
		b.URL, e = VideoURL(b.URL)
		if e != nil {
			apiError(w, e)
			return
		}
	}
	p := Project{ID: id(), Title: b.Title, URL: b.URL, Stage: "upload", Version: 1, ArabicVersion: 1, Generation: 1, Segments: []Segment{}}
	owner := who(r).User
	// Serialize creation per account so the resource bound also holds under concurrent requests.
	tx, e := a.Store.DB.Begin(r.Context())
	if e != nil {
		http.Error(w, "Création impossible", 503)
		return
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), "SELECT id FROM users WHERE id=$1 FOR UPDATE", owner)
	var count int
	if e == nil {
		e = tx.QueryRow(r.Context(), "SELECT count(*) FROM projects WHERE owner_id=$1", owner).Scan(&count)
	}
	if e != nil || count >= 30 {
		apiError(w, errors.New("Limite de 30 projets atteinte ou service indisponible"))
		return
	}
	if b.URL != "" {
		p.Stage = "preparing"
	}
	data, _ := json.Marshal(p)
	_, e = tx.Exec(r.Context(), "INSERT INTO projects(id,owner_id,document) VALUES($1,$2,$3)", p.ID, owner, data)
	if e == nil && b.URL != "" {
		e = enqueue(r.Context(), tx, owner, p, "download")
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		http.Error(w, "Création impossible", 503)
		return
	}
	jsonOut(w, p)
}
func (a *API) edit(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Field   string `json:"field"`
		Text    string `json:"text"`
		Version int64  `json:"version"`
	}
	if e := decode(w, r, &b); e != nil {
		apiError(w, e)
		return
	}
	if (b.Field != "arabic" && b.Field != "french") || strings.TrimSpace(b.Text) == "" || len(b.Text) > 16000 {
		apiError(w, errors.New("Texte invalide"))
		return
	}
	p, e := a.Store.Mutate(r.Context(), who(r).User, r.PathValue("id"), func(p *Project, tx pgx.Tx) error {
		if p.Stage != "arabic" && p.Stage != "review" && p.Stage != "ready" {
			return errors.New("Attendez la fin du traitement")
		}
		for i := range p.Segments {
			s := &p.Segments[i]
			if s.ID != r.PathValue("segment") {
				continue
			}
			if s.Version != b.Version {
				return ErrConflict
			}
			if b.Field == "french" && p.TranslationSource == 0 {
				return errors.New("Traduction absente")
			}
			old := s.Arabic
			if b.Field == "french" {
				old = s.French
			}
			if old == b.Text {
				return nil
			}
			s.Version++
			p.Version++
			p.ConfirmedReview = 0
			if b.Field == "arabic" {
				s.Arabic = b.Text
				p.ArabicVersion++
				p.ConfirmedArabic = 0
				p.Stage = "arabic"
			} else {
				s.French = b.Text
				if p.Stage == "ready" {
					p.Stage = "review"
				}
			}
			return nil
		}
		return ErrMissing
	})
	if e != nil {
		apiError(w, e)
		return
	}
	jsonOut(w, p)
}
func (a *API) rename(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Title string `json:"title"`
	}
	if e := decode(w, r, &b); e != nil {
		apiError(w, e)
		return
	}
	if strings.TrimSpace(b.Title) == "" || len(b.Title) > 300 {
		apiError(w, errors.New("Titre invalide"))
		return
	}
	p, e := a.Store.Mutate(r.Context(), who(r).User, r.PathValue("id"), func(p *Project, tx pgx.Tx) error { p.Title = b.Title; return nil })
	if e != nil {
		apiError(w, e)
		return
	}
	jsonOut(w, p)
}
func (a *API) advance(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Version int64  `json:"version"`
		Stage   string `json:"stage"`
		Replace bool   `json:"replace_translation"`
	}
	if e := decode(w, r, &b); e != nil {
		apiError(w, e)
		return
	}
	p, e := a.Store.Mutate(r.Context(), who(r).User, r.PathValue("id"), func(p *Project, tx pgx.Tx) error {
		if p.Version != b.Version {
			return ErrConflict
		}
		if e := ValidateSegments(p.Segments); e != nil {
			return e
		}
		switch b.Stage {
		case "arabic":
			if p.Stage == "translating" && p.ConfirmedArabic == p.ArabicVersion {
				return nil
			}
			if p.Stage != "arabic" {
				return ErrConflict
			}
			if p.TranslationSource == p.ArabicVersion {
				complete := true
				for _, segment := range p.Segments {
					if strings.TrimSpace(segment.French) == "" {
						complete = false
					}
				}
				if complete {
					p.ConfirmedArabic = p.ArabicVersion
					p.Stage = "review"
					return nil
				}
			}
			if p.TranslationSource > 0 && !b.Replace {
				return errors.New("La nouvelle traduction remplacera vos retouches françaises. Confirmez ce remplacement.")
			}
			p.ConfirmedArabic = p.ArabicVersion
			p.Stage = "translating"
			return enqueue(r.Context(), tx, who(r).User, *p, "translate")
		case "review":
			if p.Stage == "ready" && p.ConfirmedReview == p.Version {
				return nil
			}
			if p.Stage != "review" || p.TranslationSource != p.ArabicVersion {
				return ErrConflict
			}
			for _, s := range p.Segments {
				if strings.TrimSpace(s.French) == "" {
					return errors.New("Traduction incomplète")
				}
			}
			p.ConfirmedReview = p.Version
			p.Stage = "ready"
			return nil
		default:
			return errors.New("Étape invalide")
		}
	})
	if e != nil {
		apiError(w, e)
		return
	}
	jsonOut(w, p)
}
func (a *API) export(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Version int64  `json:"version"`
		Track   string `json:"track"`
		Quality string `json:"quality"`
	}
	if e := decode(w, r, &b); e != nil {
		apiError(w, e)
		return
	}
	if (b.Track != "ar" && b.Track != "fr") || (b.Quality != "low" && b.Quality != "high") {
		apiError(w, errors.New("Export invalide"))
		return
	}
	p, e := a.Store.Mutate(r.Context(), who(r).User, r.PathValue("id"), func(p *Project, tx pgx.Tx) error {
		if p.Version != b.Version {
			return ErrConflict
		}
		if p.Stage != "ready" || p.ConfirmedReview != p.Version || p.Media == "" {
			return errors.New("Terminez la relecture avant l’export")
		}
		return enqueue(r.Context(), tx, who(r).User, *p, "export_"+b.Track+"_"+b.Quality)
	})
	if e != nil {
		apiError(w, e)
		return
	}
	jsonOut(w, p)
}
func (a *API) upload(w http.ResponseWriter, r *http.Request) {
	owner, pid := who(r).User, r.PathValue("id")
	var generation int64
	_, e := a.Store.Mutate(r.Context(), owner, pid, func(p *Project, tx pgx.Tx) error {
		if p.Media != "" || len(p.Segments) > 0 {
			return errors.New("Ce projet possède déjà une vidéo")
		}
		p.Generation++
		p.Version++
		p.Stage = "upload"
		generation = p.Generation
		_, e := tx.Exec(r.Context(), "UPDATE jobs SET state='cancelled',lease='' WHERE project_id=$1 AND state IN ('queued','running','waiting_provider','failed')", pid)
		return e
	})
	if e != nil {
		apiError(w, e)
		return
	}
	// Reserve disk budget across upload processes; lock is released even on interrupted uploads.
	conn, e := a.Store.DB.Acquire(r.Context())
	if e != nil {
		http.Error(w, "Import indisponible", 503)
		return
	}
	defer conn.Release()
	var locked bool
	e = conn.QueryRow(r.Context(), "SELECT pg_try_advisory_lock(91372611)").Scan(&locked)
	if e != nil || !locked {
		http.Error(w, "Un import est en cours. Réessayez dans un instant.", 429)
		return
	}
	defer conn.Exec(r.Context(), "SELECT pg_advisory_unlock(91372611)")
	if e = storageRoom(a.Config.Storage, MaxMediaBytes); e != nil {
		apiError(w, e)
		return
	}
	name := id()
	path := storagePath(a.Config.Storage, name)
	f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		http.Error(w, "Stockage indisponible", 503)
		return
	}
	keep := false
	defer func() {
		f.Close()
		if !keep {
			os.Remove(path)
		}
	}()
	n, e := io.Copy(f, http.MaxBytesReader(w, r.Body, MaxMediaBytes))
	if e != nil || n < 16 {
		apiError(w, errors.New("Import incomplet ou supérieur à 1 Go. Réessayez avec une vidéo plus petite."))
		return
	}
	if e = f.Sync(); e != nil {
		http.Error(w, "Stockage indisponible", 503)
		return
	}
	f.Close()
	p, e := a.Store.Mutate(r.Context(), owner, pid, func(p *Project, tx pgx.Tx) error {
		if p.Generation != generation {
			return ErrConflict
		}
		p.Stage = "preparing"
		input := *p
		input.Media = name
		return enqueue(r.Context(), tx, owner, input, "prepare")
	})
	if e != nil {
		apiError(w, e)
		return
	}
	keep = true
	jsonOut(w, p)
}
func storageRoom(root string, reserve int64) error {
	var stats syscall.Statfs_t
	if e := syscall.Statfs(root, &stats); e != nil {
		return e
	}
	if int64(stats.Bavail)*int64(stats.Bsize) < reserve+2*1024*1024*1024 {
		return errors.New("Espace disque insuffisant")
	}
	var size int64
	e := filepath.WalkDir(root, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type().IsRegular() {
			info, e := entry.Info()
			if e != nil {
				return e
			}
			size += info.Size()
		}
		return nil
	})
	if e != nil {
		return e
	}
	if size+reserve > MaxStorageBytes {
		return errors.New("Stockage du service plein ; contactez l’administrateur")
	}
	return nil
}
func (a *API) media(w http.ResponseWriter, r *http.Request) {
	p, e := a.Store.Get(r.Context(), who(r).User, r.PathValue("id"))
	if e != nil {
		apiError(w, e)
		return
	}
	if p.Media == "" {
		apiError(w, ErrMissing)
		return
	}
	servePrivate(w, r, storagePath(a.Config.Storage, p.Media), false)
}
func servePrivate(w http.ResponseWriter, r *http.Request, path string, download bool) {
	f, e := os.Open(path)
	if e != nil {
		apiError(w, ErrMissing)
		return
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		apiError(w, ErrMissing)
		return
	}
	w.Header().Set("Content-Type", "video/mp4")
	if download {
		w.Header().Set("Content-Disposition", `attachment; filename="tarjama.mp4"`)
	}
	http.ServeContent(w, r, "video.mp4", st.ModTime(), f)
}
func (a *API) downloadExport(w http.ResponseWriter, r *http.Request) {
	var state string
	e := a.Store.DB.QueryRow(r.Context(), "SELECT state FROM jobs WHERE id=$1 AND project_id=$2 AND owner_id=$3 AND kind LIKE 'export_%'", r.PathValue("job"), r.PathValue("id"), who(r).User).Scan(&state)
	if e != nil || state != "succeeded" {
		apiError(w, ErrMissing)
		return
	}
	servePrivate(w, r, storagePath(a.Config.Storage, r.PathValue("job")+".mp4"), true)
}
func (a *API) cancel(w http.ResponseWriter, r *http.Request) {
	_, e := a.Store.Mutate(r.Context(), who(r).User, r.PathValue("id"), func(p *Project, tx pgx.Tx) error {
		tag, e := tx.Exec(r.Context(), "UPDATE jobs SET state='cancelled',lease='',message='Traitement annulé' WHERE id=$1 AND project_id=$2 AND owner_id=$3 AND state IN ('queued','running','waiting_provider')", r.PathValue("job"), p.ID, who(r).User)
		if e != nil {
			return e
		}
		if tag.RowsAffected() == 0 {
			return ErrMissing
		}
		return nil
	})
	if e != nil {
		apiError(w, e)
		return
	}
	w.WriteHeader(204)
}
func (a *API) retry(w http.ResponseWriter, r *http.Request) {
	_, e := a.Store.Mutate(r.Context(), who(r).User, r.PathValue("id"), func(p *Project, tx pgx.Tx) error {
		tag, e := tx.Exec(r.Context(), "UPDATE jobs SET media_attempt=media_attempt+CASE WHEN state IN ('failed','cancelled') THEN 1 ELSE 0 END,state='queued',next_attempt_at=now(),attempts=0,message='' WHERE id=$1 AND project_id=$2 AND owner_id=$3 AND state IN ('failed','cancelled','waiting_provider') AND generation=$4 AND (kind LIKE 'export_%' OR source_version=$5)", r.PathValue("job"), p.ID, who(r).User, p.Generation, p.Version)
		if e != nil {
			return e
		}
		if tag.RowsAffected() == 0 {
			return ErrConflict
		}
		return nil
	})
	if e != nil {
		apiError(w, e)
		return
	}
	w.WriteHeader(204)
}
func (a *API) delete(w http.ResponseWriter, r *http.Request) {
	tag, e := a.Store.DB.Exec(r.Context(), "DELETE FROM projects WHERE id=$1 AND owner_id=$2", r.PathValue("id"), who(r).User)
	if e != nil {
		http.Error(w, "Suppression impossible", 503)
		return
	}
	if tag.RowsAffected() == 0 {
		apiError(w, ErrMissing)
		return
	}
	w.WriteHeader(204)
}
func (a *API) keyStatus(w http.ResponseWriter, r *http.Request) {
	rows, e := a.Store.DB.Query(r.Context(), "SELECT provider FROM credentials WHERE owner_id=$1", who(r).User)
	if e != nil {
		http.Error(w, "Lecture impossible", 503)
		return
	}
	defer rows.Close()
	out := map[string]bool{"gemini": false, "groq": false}
	for rows.Next() {
		var p string
		if rows.Scan(&p) == nil {
			out[p] = true
		}
	}
	jsonOut(w, out)
}

// Server timeouts also bound slow uploads; provider jobs run outside HTTP requests.
func HTTPServer(addr string, h http.Handler) *http.Server {
	return &http.Server{Addr: addr, Handler: h, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 10 * time.Minute, WriteTimeout: 10 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
}
