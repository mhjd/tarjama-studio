package studio

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type DesktopBundle struct {
	Project  Project
	Media    string
	Digest   string
	Warnings []string
}

func readJSON(path string, v any) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	return json.NewDecoder(io.LimitReader(f, 16*1024*1024)).Decode(v)
}
func ReadDesktop(dir string) (DesktopBundle, error) {
	var result DesktopBundle
	var meta struct {
		Title string `json:"title"`
	}
	if e := readJSON(filepath.Join(dir, "project.json"), &meta); e != nil {
		return result, e
	}
	var transcript struct {
		Segments []struct {
			ID          json.RawMessage `json:"id"`
			Start       float64         `json:"start"`
			End         float64         `json:"end"`
			Text        string          `json:"text"`
			Translation string          `json:"translation"`
		} `json:"segments"`
	}
	source := filepath.Join(dir, "current.json")
	if _, e := os.Stat(source); os.IsNotExist(e) {
		source = filepath.Join(dir, "transcript.json")
	}
	if e := readJSON(source, &transcript); e != nil {
		return result, e
	}
	p := Project{ID: id(), Title: meta.Title, Stage: "arabic", Version: 1, ArabicVersion: 1, Generation: 1, Segments: []Segment{}}
	for _, s := range transcript.Segments {
		var sid string
		if json.Unmarshal(s.ID, &sid) != nil {
			var num json.Number
			if json.Unmarshal(s.ID, &num) != nil {
				return result, errors.New("ID invalide")
			}
			sid = num.String()
		}
		if math.IsNaN(s.Start) || math.IsInf(s.Start, 0) || math.IsNaN(s.End) || math.IsInf(s.End, 0) {
			return result, errors.New("Timestamp invalide")
		}
		p.Segments = append(p.Segments, Segment{ID: sid, Start: int64(math.Round(s.Start * 1000)), End: int64(math.Round(s.End * 1000)), Arabic: s.Text, French: s.Translation, Version: 1})
	}
	var translation struct {
		Segments []struct {
			ID          string  `json:"id"`
			Start       float64 `json:"start"`
			End         float64 `json:"end"`
			Translation string  `json:"translation"`
		} `json:"segments"`
	}
	e := readJSON(filepath.Join(dir, "translation.json"), &translation)
	if e == nil {
		if len(translation.Segments) != len(p.Segments) {
			return result, errors.New("Traduction desktop non alignée")
		}
		for i, t := range translation.Segments {
			s := &p.Segments[i]
			if t.ID != s.ID || int64(math.Round(t.Start*1000)) != s.Start || int64(math.Round(t.End*1000)) != s.End {
				return result, errors.New("IDs/timestamps de traduction non alignés")
			}
			if s.French != "" && s.French != t.Translation {
				return result, errors.New("Conflit traduction embarquée/séparée")
			}
			s.French = t.Translation
		}
	} else if !os.IsNotExist(e) {
		return result, e
	}
	if e = ValidateSegments(p.Segments); e != nil {
		return result, e
	}
	complete := true
	for _, s := range p.Segments {
		if strings.TrimSpace(s.French) == "" {
			complete = false
		}
	}
	if complete {
		p.Stage = "review"
		p.TranslationSource = p.ArabicVersion
		p.ConfirmedArabic = p.ArabicVersion
	}
	files, e := filepath.Glob(filepath.Join(dir, "source.*"))
	if e != nil || len(files) != 1 {
		return result, errors.New("Un seul fichier source.<extension> est requis")
	}
	st, e := os.Lstat(files[0])
	if e != nil || !st.Mode().IsRegular() || st.Size() > MaxMediaBytes {
		return result, errors.New("Média invalide (liens symboliques refusés)")
	}
	// Metadata fingerprint is deliberately not trusted as proof of human validation.
	result.Warnings = []string{"Revalidation humaine requise ; confirmations desktop non transférées.", "Snapshots et sorties desktop laissés intacts."}
	if source == filepath.Join(dir, "current.json") {
		result.Warnings = append(result.Warnings, "current.json prioritaire sur transcript.json")
	}
	digest := sha256.New()
	b, _ := json.Marshal(p.Segments)
	digest.Write(b)
	digest.Write([]byte(p.Title))
	f, e := os.Open(files[0])
	if e != nil {
		return result, e
	}
	_, e = io.Copy(digest, f)
	f.Close()
	if e != nil {
		return result, e
	}
	result.Project = p
	result.Media = files[0]
	result.Digest = hex.EncodeToString(digest.Sum(nil))
	return result, nil
}
func ImportCommand(ctx context.Context, s *Store, c Config, args []string) error {
	flags := flag.NewFlagSet("import", flag.ContinueOnError)
	dir := flags.String("bundle", "", "copie desktop")
	owner := flags.String("owner", "", "ID propriétaire explicite")
	apply := flags.Bool("apply", false, "copier après dry-run")
	if e := flags.Parse(args); e != nil {
		return e
	}
	if *dir == "" || *owner == "" {
		return errors.New("--bundle et --owner requis")
	}
	bundle, e := ReadDesktop(*dir)
	if e != nil {
		return e
	}
	var exists bool
	if e = s.DB.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)", *owner).Scan(&exists); e != nil || !exists {
		return errors.New("Propriétaire absent")
	}
	if !*apply {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"dry_run": true, "owner": *owner, "title": bundle.Project.Title, "segments": len(bundle.Project.Segments), "warnings": bundle.Warnings, "digest": bundle.Digest})
	}
	var previous string
	if e = s.DB.QueryRow(ctx, "SELECT project_id FROM imports WHERE owner_id=$1 AND digest=$2", *owner, bundle.Digest).Scan(&previous); e == nil {
		fmt.Println("Déjà importé :", previous)
		return nil
	}
	if e = storageRoom(c.Storage, MaxMediaBytes); e != nil {
		return e
	}
	name := id() + ".mp4"
	path := storagePath(c.Storage, name)
	media := RemoteMedia{URL: c.MediaURL, Token: c.MediaToken, Client: NewProviders().Client}
	info, e := media.Process(ctx, MediaRequest{Operation: "prepare"}, bundle.Media, path)
	if e != nil {
		return e
	}
	keep := false
	defer func() {
		if !keep {
			os.Remove(path)
		}
	}()
	p := bundle.Project
	p.Media = name
	p.Duration = info.Duration
	p.Width = info.Width
	p.Height = info.Height
	if p.Segments[len(p.Segments)-1].End > info.Duration+100 {
		return errors.New("Segments après la fin du média")
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	b, _ := json.Marshal(p)
	_, e = tx.Exec(ctx, "INSERT INTO projects(id,owner_id,document) VALUES($1,$2,$3)", p.ID, *owner, b)
	if e == nil {
		_, e = tx.Exec(ctx, "INSERT INTO imports(owner_id,digest,project_id) VALUES($1,$2,$3)", *owner, bundle.Digest, p.ID)
	}
	if e != nil {
		return e
	}
	if e = tx.Commit(ctx); e != nil {
		return e
	}
	keep = true
	fmt.Println("Importé :", p.ID)
	return nil
}
func GarbageCollect(ctx context.Context, s *Store, c Config) error {
	// Only unreachable hosted objects older than 24h, never desktop files/snapshots.
	live := map[string]bool{}
	rows, e := s.DB.Query(ctx, `SELECT document->>'media' FROM projects UNION SELECT input->>'media' FROM jobs WHERE state IN ('queued','running','waiting_provider','failed','cancelled') UNION SELECT id||'.mp4' FROM jobs WHERE kind LIKE 'export_%' AND state IN ('succeeded','running')`)
	if e != nil {
		return e
	}
	for rows.Next() {
		var name *string
		if rows.Scan(&name) == nil && name != nil {
			live[*name] = true
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	entries, e := os.ReadDir(c.Storage)
	if e != nil {
		return e
	}
	for _, entry := range entries {
		info, e := entry.Info()
		if e != nil || !info.Mode().IsRegular() || live[entry.Name()] || time.Since(info.ModTime()) < 24*time.Hour {
			continue
		}
		if !safeID.MatchString(strings.TrimSuffix(entry.Name(), ".mp4")) {
			continue
		}
		if e = os.Remove(storagePath(c.Storage, entry.Name())); e != nil {
			return e
		}
	}
	_, e = s.DB.Exec(ctx, "DELETE FROM sessions WHERE expires_at<now(); DELETE FROM login_flows WHERE expires_at<now()")
	return e
}
