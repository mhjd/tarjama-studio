package studio

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// IsolatedMedia orchestrates files only; it never executes ffmpeg/ffprobe/yt-dlp.
// All profile names below are fixed project contracts requiring administrator review.
type IsolatedMedia struct {
	Store   *Store
	Client  *IsolatedClient
	Storage string
	Job     Job
	Unit    int // ASR chunk ordinal, -1 for whole-project preparation/export
	Poll    time.Duration
}

func (m *IsolatedMedia) ForJob(j Job, unit int) Media {
	copy := *m
	copy.Job = j
	copy.Unit = unit
	return &copy
}
func (m *IsolatedMedia) operationDir(key string) string {
	return filepath.Join(m.Storage, "operations", key)
}

// Count completed durable stages, never estimated download bytes or elapsed time.
// Keep these updates behind the same ownership/version/lease fence as results.
func (m *IsolatedMedia) reportProgress(ctx context.Context, step string, complete bool) error {
	type phase struct{ key, label string }
	steps := []phase{}
	if m.Job.Kind == "download" {
		steps = append(steps, phase{"download-video", "Téléchargement de la vidéo…"},
			phase{"download-audio", "Téléchargement de l’audio…"},
			phase{"mux", "Assemblage de la vidéo et de l’audio…"})
	} else if m.Job.Kind != "prepare" && !strings.HasPrefix(m.Job.Kind, "export_") {
		return nil // Transcription/text jobs already report completed chunks.
	}
	render := "Préparation de la vidéo pour la lecture…"
	if strings.HasPrefix(m.Job.Kind, "export_") {
		render = "Création de la vidéo sous-titrée…"
	}
	steps = append(steps, phase{"source-probe", "Vérification de la vidéo…"},
		phase{"render", render},
		phase{"result-probe", "Vérification du résultat…"})
	for i, phase := range steps {
		if phase.key != step {
			continue
		}
		count := i
		if complete {
			count++
		}
		message := phase.label
		if count == len(steps) {
			message = "Finalisation de la vidéo…"
		}
		progress := count * 100 / len(steps)
		return m.mutate(ctx, func(tx pgx.Tx) error {
			_, e := tx.Exec(ctx, `UPDATE jobs SET
 message=CASE WHEN progress<=$3 THEN $2 ELSE message END,
 progress=GREATEST(progress,$3),updated_at=now() WHERE id=$1`, m.Job.ID, message, progress)
			return e
		})
	}
	return nil
}

func (m *IsolatedMedia) operation(ctx context.Context, step, profile string, params map[string]string, inputs map[string]string, output string, maxOutput int64) (string, error) {
	key := hash(fmt.Sprintf("%s/%d/%d/%s", m.Job.ID, m.Job.MediaAttempt, m.Unit, step))
	def := operationDefinition{Request: operationRequest{Key: key, Profile: profile, Params: params}, Inputs: map[string]inputFingerprint{}, Output: output, MaxOutput: maxOutput}
	for name, path := range inputs {
		fp, e := fingerprint(path, MaxMediaBytes)
		if e != nil {
			return "", e
		}
		def.Inputs[name] = fp
	}
	dir := m.operationDir(key)
	lock, e := lockOperation(ctx, dir, true)
	if e != nil {
		return "", e
	}
	defer lock.Close()
	op, e := m.record(ctx, def)
	if e != nil {
		return "", e
	}
	result := filepath.Join(dir, "result")
	ack := func() {
		if !op.Acknowledged && m.Client.action(ctx, op.RemoteID, "ack") == nil {
			m.Store.DB.Exec(ctx, "UPDATE media_operations SET acknowledged=true WHERE key=$1", key)
		}
	}
	if op.Cached {
		fp, e := fingerprint(result, maxOutput)
		if e != nil || fp != op.Fingerprint {
			return "", errors.New("Résultat durable perdu ou altéré ; réessai explicite requis")
		}
		ack()
		return result, m.reportProgress(ctx, step, true)
	}
	if e = m.reportProgress(ctx, step, false); e != nil {
		return "", e
	}
	var remote remoteOperation
	if op.RemoteID == "" {
		remote, e = m.Client.create(ctx, def.Request)
		if e != nil {
			return "", e
		}
		if e = m.updateRemote(ctx, &op, remote.ID); e != nil {
			return "", e
		}
	}
	remote, e = m.Client.status(ctx, op.RemoteID)
	if e != nil {
		return "", e
	}
	if remote.State == "staging" {
		for name, path := range inputs {
			if e = m.Client.upload(ctx, op.RemoteID, name, path, def.Inputs[name]); e != nil {
				return "", e
			}
		}
		if e = m.mutate(ctx, func(pgx.Tx) error { return nil }); e != nil {
			return "", e
		}
		if e = m.Client.action(ctx, op.RemoteID, "start"); e != nil {
			return "", e
		}
	}
	poll := m.Poll
	if poll <= 0 {
		poll = 2 * time.Second
	}
	deadline := time.NewTimer(5 * time.Hour)
	defer deadline.Stop()
	for {
		remote, e = m.Client.status(ctx, op.RemoteID)
		if e != nil {
			return "", e
		}
		if remoteTerminal(remote.State) {
			break
		}
		switch remote.State {
		case "staging", "queued", "starting", "running", "collecting", "cleaning", "cancelling":
		default:
			return "", errors.New("État distant inconnu")
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-deadline.C:
			return "", mediaUnavailable()
		case <-time.After(poll):
		}
	}
	if remote.State != "succeeded" {
		return "", errors.New("Opération isolée terminée sans résultat disponible ; réessai explicite requis")
	}
	if e = storageRoom(m.Storage, maxOutput); e != nil {
		return "", e
	}
	partial := filepath.Join(dir, "partial")
	// Crash after rename but before database commit: put the uncommitted file back
	// into the transfer path, verify it and finish the same operation, without rerun.
	if _, e = os.Stat(result); e == nil {
		if e = os.Rename(result, partial); e != nil {
			return "", e
		}
	}
	fp, e := m.Client.download(ctx, op.RemoteID, output, partial, maxOutput, op.Fingerprint, func(fp inputFingerprint) error {
		return m.mutate(ctx, func(tx pgx.Tx) error {
			_, e := tx.Exec(ctx, "UPDATE media_operations SET size=$2,sha256=$3 WHERE key=$1", key, fp.Size, fp.SHA256)
			return e
		})
	})
	if e != nil {
		return "", e
	}
	// Cache publication and ownership validation share a short transaction. This
	// does not publish business state; Worker.Finish/Chunk still fence that commit.
	e = m.mutate(ctx, func(tx pgx.Tx) error {
		if e := os.Rename(partial, result); e != nil {
			return e
		}
		if e := syncDirectory(dir); e != nil {
			return e
		}
		if e := syncDirectory(filepath.Dir(dir)); e != nil {
			return e
		}
		if e := syncDirectory(m.Storage); e != nil {
			return e
		}
		_, e := tx.Exec(ctx, "UPDATE media_operations SET cached=true,size=$2,sha256=$3,updated_at=now() WHERE key=$1", key, fp.Size, fp.SHA256)
		return e
	})
	if e != nil {
		return "", e
	}
	ack()
	return result, m.reportProgress(ctx, step, true)
}

func (m *IsolatedMedia) probe(ctx context.Context, step, input string) (MediaInfo, error) {
	st, e := os.Stat(input)
	if e != nil {
		return MediaInfo{}, e
	}
	profile := "media-probe"
	if st.Size() > 512*1024*1024 {
		profile = "tarjama-probe-v1"
	}
	path, e := m.operation(ctx, step, profile, map[string]string{}, map[string]string{"media": input}, "stdout", 1024*1024)
	if e != nil {
		return MediaInfo{}, e
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return MediaInfo{}, e
	}
	return parseMediaProbe(b)
}

func (m *IsolatedMedia) Process(ctx context.Context, p MediaRequest, input, output string) (MediaInfo, error) {
	var info MediaInfo
	if p.Operation == "download" {
		u, e := VideoURL(p.URL)
		if e != nil {
			return info, e
		}
		video, e := m.operation(ctx, "download-video", "tarjama-download-v1", map[string]string{"url": u, "track": "video"}, nil, "media", MaxMediaBytes)
		if e != nil {
			return info, e
		}
		audio, e := m.operation(ctx, "download-audio", "tarjama-download-v1", map[string]string{"url": u, "track": "audio"}, nil, "media", MaxMediaBytes)
		if e != nil {
			return info, e
		}
		// yt-dlp never invokes FFmpeg in the operation that has a proxy relay.
		input, e = m.operation(ctx, "mux", "tarjama-mux-v1", map[string]string{}, map[string]string{"media": video, "audio": audio}, "result.mkv", MaxMediaBytes)
		if e != nil {
			return info, e
		}
	}
	info, e := m.probe(ctx, "source-probe", input)
	if e != nil {
		return info, e
	}
	var result string
	switch p.Operation {
	case "audio":
		if math.IsNaN(p.Start) || math.IsNaN(p.Duration) || math.IsInf(p.Start, 0) || math.IsInf(p.Duration, 0) || p.Start < 0 || p.Duration <= 0 || p.Duration > 600 {
			return info, errors.New("Morceau invalide")
		}
		start := int64(math.Round(p.Start * 1000))
		duration := min(int64(math.Round(p.Duration*1000)), info.Duration-start)
		if start >= info.Duration || duration <= 0 {
			return info, errors.New("Morceau hors média")
		}
		result, e = m.operation(ctx, "audio", "tarjama-audio-v1", map[string]string{"start_ms": strconv.FormatInt(start, 10), "duration_ms": strconv.FormatInt(duration, 10)}, map[string]string{"media": input}, "audio.flac", 23*1024*1024)
		info.ChunkDuration = float64(duration) / 1000
	case "prepare", "download", "export":
		quality := "high"
		profile := "tarjama-normalize-v1"
		inputs := map[string]string{"media": input}
		if p.Operation == "export" {
			if (p.Track != "ar" && p.Track != "fr") || (p.Quality != "low" && p.Quality != "high") {
				return info, errors.New("Export invalide")
			}
			if e = ValidateSegments(p.Segments); e != nil {
				return info, e
			}
			quality = p.Quality
			profile = "tarjama-export-v1"
		}
		w, h := Dimensions(info.Width, info.Height, quality)
		if p.Operation == "export" {
			f, e := os.CreateTemp(m.Storage, "subtitle-")
			if e != nil {
				return info, e
			}
			defer os.Remove(f.Name())
			_, e = f.WriteString(ASS(p.Segments, w, h, p.Track))
			closeErr := f.Close()
			if e != nil {
				return info, e
			}
			if closeErr != nil {
				return info, closeErr
			}
			inputs["subtitles.ass"] = f.Name()
		}
		result, e = m.operation(ctx, "render", profile, map[string]string{"width": strconv.Itoa(w), "height": strconv.Itoa(h), "quality": quality}, inputs, "result.mp4", MaxMediaBytes)
		if e == nil {
			info, e = m.probe(ctx, "result-probe", result)
		}
	default:
		return info, errors.New("Opération média invalide")
	}
	if e != nil {
		return info, e
	}
	if e = m.mutate(ctx, func(pgx.Tx) error { return nil }); e != nil {
		return info, e
	}
	return info, copyDurable(result, output)
}

func copyDurable(source, destination string) error {
	in, e := os.Open(source)
	if e != nil {
		return e
	}
	defer in.Close()
	st, e := in.Stat()
	if e != nil {
		return e
	}
	if e = storageRoom(filepath.Dir(destination), st.Size()); e != nil {
		return e
	}
	out, e := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	ok := false
	defer func() {
		out.Close()
		if !ok {
			os.Remove(destination)
		}
	}()
	if _, e = io.Copy(out, in); e != nil {
		return e
	}
	if e = out.Sync(); e != nil {
		return e
	}
	if e = syncDirectory(filepath.Dir(destination)); e != nil {
		return e
	}
	ok = true
	return nil
}
