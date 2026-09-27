package studio

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"os"
	"strings"
	"time"
)

func independentMediaJob(kind string) bool {
	return strings.HasPrefix(kind, "export_") || strings.HasPrefix(kind, "restore_")
}
func renewMediaExpiry(p *Project, now time.Time) {
	ttl := 24 * time.Hour
	if p.MediaUploaded || p.URL == "" {
		ttl = 7 * 24 * time.Hour
	}
	expires := now.Add(ttl)
	p.MediaExpiresAt = &expires
}
func removeVideo(root, name string) error {
	if name == "" {
		return nil
	}
	err := os.Remove(storagePath(root, name))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// Only files explicitly owned by a project/job are eligible. Never walk/delete
// storage directories, text records, reference corpora, or database backups.
// The project lock serializes this decision with enqueue, retry and publication.
func (s *Store) ExpireVideos(ctx context.Context, root string, now time.Time) error {
	rows, err := s.DB.Query(ctx, `SELECT p.owner_id,p.id FROM projects p WHERE
 p.document->>'stage' IN ('arabic','review','ready')
 AND NOT EXISTS(SELECT 1 FROM jobs a WHERE a.project_id=p.id AND a.state IN ('queued','running','waiting_provider')) AND (
 (COALESCE(p.document->>'media','')<>'' AND
   (p.document->>'media_expires_at' IS NULL OR (p.document->>'media_expires_at')::timestamptz<=$1))
 OR EXISTS(SELECT 1 FROM jobs j WHERE j.project_id=p.id AND j.kind LIKE 'export_%' AND j.state='succeeded' AND j.updated_at<=$1::timestamptz-interval '24 hours'))
 ORDER BY p.created_at LIMIT 100`, now)
	if err != nil {
		return err
	}
	type target struct{ owner, id string }
	var targets []target
	for rows.Next() {
		var v target
		if err = rows.Scan(&v.owner, &v.id); err != nil {
			break
		}
		targets = append(targets, v)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	for _, v := range targets {
		_, err = s.Mutate(ctx, v.owner, v.id, func(p *Project, tx pgx.Tx) error {
			if p.Stage != "arabic" && p.Stage != "review" && p.Stage != "ready" {
				return nil
			}
			var active bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM jobs WHERE project_id=$1 AND state IN ('queued','running','waiting_provider'))`, p.ID).Scan(&active); err != nil {
				return err
			}
			if active {
				return nil
			}
			// Existing installations get the full grace period on first sweep.
			if p.Media != "" && (!p.MediaUploaded || p.MediaExpiresAt == nil) {
				var uploaded bool
				if err := tx.QueryRow(ctx, `SELECT COALESCE((SELECT kind IN ('prepare','restore_prepare') FROM jobs WHERE project_id=$1 AND kind IN ('prepare','restore_prepare','download','restore_download') AND state='succeeded' ORDER BY updated_at DESC LIMIT 1),false)`, p.ID).Scan(&uploaded); err != nil {
					return err
				}
				correctedOrigin := uploaded && !p.MediaUploaded
				p.MediaUploaded = p.MediaUploaded || uploaded
				if p.MediaExpiresAt == nil || correctedOrigin {
					renewMediaExpiry(p, now)
				}
			}
			if p.Media != "" && p.MediaExpiresAt != nil && !p.MediaExpiresAt.After(now) {
				names, err := tx.Query(ctx, `SELECT DISTINCT input->>'media' FROM jobs WHERE project_id=$1 AND kind IN ('prepare','restore_prepare') AND COALESCE(input->>'media','')<>''`, p.ID)
				if err != nil {
					return err
				}
				var originals []string
				for names.Next() {
					var name string
					if err = names.Scan(&name); err != nil {
						break
					}
					originals = append(originals, name)
				}
				if err == nil {
					err = names.Err()
				}
				names.Close()
				if err != nil {
					return err
				}
				for _, name := range originals {
					if err = removeVideo(root, name); err != nil {
						return err
					}
				}
				if err = removeVideo(root, p.Media); err != nil {
					return err
				}
				p.Media = ""
				p.MediaExpired = true
				p.MediaExpiresAt = nil
			}
			exports, err := tx.Query(ctx, `SELECT id FROM jobs WHERE project_id=$1 AND kind LIKE 'export_%' AND state='succeeded' AND updated_at<=$2::timestamptz-interval '24 hours'`, p.ID, now)
			if err != nil {
				return err
			}
			var ids []string
			for exports.Next() {
				var id string
				if err = exports.Scan(&id); err != nil {
					break
				}
				ids = append(ids, id)
			}
			if err == nil {
				err = exports.Err()
			}
			exports.Close()
			if err != nil {
				return err
			}
			for _, id := range ids {
				if err = removeVideo(root, id+".mp4"); err != nil {
					return err
				}
				if _, err = tx.Exec(ctx, `UPDATE jobs SET state='expired',message='Vidéo supprimée après 24 heures',updated_at=now() WHERE id=$1`, id); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil && !errors.Is(err, ErrMissing) {
			return err
		}
	}
	return nil
}
