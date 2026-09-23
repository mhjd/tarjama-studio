package studio

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type MediaRequest struct {
	Operation string    `json:"operation"`
	URL       string    `json:"url,omitempty"`
	Start     float64   `json:"start"`
	Duration  float64   `json:"duration"`
	Quality   string    `json:"quality,omitempty"`
	Track     string    `json:"track,omitempty"`
	Segments  []Segment `json:"segments,omitempty"`
}
type MediaInfo struct {
	Duration      int64   `json:"duration_ms"`
	Width         int     `json:"width"`
	Height        int     `json:"height"`
	ChunkDuration float64 `json:"chunk_duration"`
}
type Media interface {
	Process(context.Context, MediaRequest, string, string) (MediaInfo, error)
}
type RemoteMedia struct {
	URL, Token string
	Client     *http.Client
}

func (m *RemoteMedia) Process(ctx context.Context, p MediaRequest, input, output string) (MediaInfo, error) {
	var info MediaInfo
	reader, writer := io.Pipe()
	form := multipart.NewWriter(writer)
	done := make(chan error, 1)
	go func() {
		var e error
		defer func() { writer.CloseWithError(e); done <- e }()
		b, _ := json.Marshal(p)
		e = form.WriteField("request", string(b))
		if e != nil {
			return
		}
		if input != "" {
			var f *os.File
			f, e = os.Open(input)
			if e != nil {
				return
			}
			defer f.Close()
			var part io.Writer
			part, e = form.CreateFormFile("file", "input")
			if e != nil {
				return
			}
			_, e = io.Copy(part, f)
			if e != nil {
				return
			}
		}
		e = form.Close()
	}()
	req, e := http.NewRequestWithContext(ctx, "POST", m.URL+"/process", reader)
	if e != nil {
		reader.Close()
		return info, e
	}
	req.Header.Set("Authorization", "Bearer "+m.Token)
	req.Header.Set("Content-Type", form.FormDataContentType())
	resp, e := m.Client.Do(req)
	if e != nil {
		reader.Close()
		<-done
		return info, &ProviderError{Public: "Traitement vidéo indisponible. Réessayez ou importez votre vidéo.", Temporary: true, After: time.Minute}
	}
	defer resp.Body.Close()
	reader.Close()
	<-done
	if resp.StatusCode != 200 {
		if resp.StatusCode == 429 || resp.StatusCode == 503 {
			return info, &ProviderError{Public: "Téléchargement ou traitement indisponible. Reprise automatique ; vous pouvez importer la vidéo depuis votre appareil.", Temporary: true, After: time.Minute}
		}
		return info, errors.New("Vidéo non reconnue, trop longue, trop grande ou sans audio et vidéo")
	}
	if e = json.Unmarshal([]byte(resp.Header.Get("X-Media-Info")), &info); e != nil {
		return info, e
	}
	f, e := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return info, e
	}
	ok := false
	defer func() {
		f.Close()
		if !ok {
			os.Remove(output)
		}
	}()
	n, e := io.Copy(f, io.LimitReader(resp.Body, MaxMediaBytes+1))
	if e != nil || n > MaxMediaBytes || n == 0 {
		return info, errors.New("Média produit incomplet ou trop grand")
	}
	e = f.Sync()
	ok = e == nil
	return info, e
}

type LocalMedia struct {
	Test         bool
	ConsumeInput bool // only private upload files owned by the RPC handler
	Proxy        string
}
type limitedBuffer struct {
	bytes.Buffer
	Limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.Limit {
		return 0, errors.New("sortie outil trop grande")
	}
	return b.Buffer.Write(p)
}
func (m LocalMedia) run(ctx context.Context, dir, program string, args ...string) ([]byte, error) {
	timeout := 4 * time.Hour
	if program == "ffprobe" {
		timeout = 30 * time.Second
	}
	if program == "yt-dlp" {
		timeout = 30 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	binary := program
	argv := args
	if !m.Test {
		argv = []string{"--die-with-parent", "--new-session", "--unshare-all", "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64", "--ro-bind", "/etc/ssl/certs", "/etc/ssl/certs", "--ro-bind", "/etc/fonts", "/etc/fonts", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--bind", dir, "/job", "--chdir", "/job", "--clearenv", "--setenv", "PATH", "/usr/bin:/usr/local/bin", "--setenv", "HOME", "/tmp"}
		if program == "yt-dlp" {
			argv = append(argv, "--share-net", "--ro-bind", "/etc/resolv.conf", "/etc/resolv.conf")
		}
		argv = append(argv, "--", program)
		argv = append(argv, args...)
		binary = "bwrap"
	}
	argv = append([]string{"--fsize=1073741824", "--cpu=14400", "--nofile=128", "--", binary}, argv...)
	cmd := exec.CommandContext(ctx, "prlimit", argv...)
	cmd.Dir = dir
	cmd.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "LANG=C.UTF-8"}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = time.Second
	stdout := &limitedBuffer{Limit: 4 * 1024 * 1024}
	stderr := &limitedBuffer{Limit: 256 * 1024}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	e := cmd.Run()
	if e != nil {
		return nil, errors.New("outil média refusé ou en échec")
	}
	return stdout.Bytes(), nil
}
func (m LocalMedia) probe(ctx context.Context, dir, input string) (MediaInfo, error) {
	raw, e := m.run(ctx, dir, "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", input)
	if e != nil {
		return MediaInfo{}, e
	}
	return parseMediaProbe(raw)
}
func parseMediaProbe(raw []byte) (MediaInfo, error) {
	var data struct {
		Streams []struct {
			CodecType         string `json:"codec_type"`
			Width             int    `json:"width"`
			Height            int    `json:"height"`
			SampleAspectRatio string `json:"sample_aspect_ratio"`
			SideData          []struct {
				Rotation float64 `json:"rotation"`
			} `json:"side_data_list"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if json.Unmarshal(raw, &data) != nil {
		return MediaInfo{}, errors.New("Média invalide")
	}
	duration, _ := strconv.ParseFloat(data.Format.Duration, 64)
	info := MediaInfo{Duration: int64(math.Round(duration * 1000))}
	audio := false
	for _, s := range data.Streams {
		if s.CodecType == "audio" {
			audio = true
		}
		if s.CodecType == "video" && info.Width == 0 {
			info.Width = s.Width
			info.Height = s.Height
			var sarN, sarD float64
			if _, e := fmt.Sscanf(s.SampleAspectRatio, "%f:%f", &sarN, &sarD); e == nil && sarN > 0 && sarD > 0 {
				// Preserve display aspect ratio without increasing either coded dimension.
				if sarN < sarD {
					info.Width = int(float64(s.Width) * sarN / sarD)
				} else {
					info.Height = int(float64(s.Height) * sarD / sarN)
				}
			}
			for _, side := range s.SideData {
				if int(math.Abs(side.Rotation))%180 == 90 {
					info.Width, info.Height = info.Height, info.Width
					break
				}
			}
		}
	}
	if !audio || info.Width < 2 || info.Height < 2 || info.Width > 8192 || info.Height > 8192 || duration <= 0 || duration > 10800 || math.IsNaN(duration) || math.IsInf(duration, 0) {
		return info, errors.New("Une vidéo avec audio de moins de 3 heures est requise")
	}
	return info, nil
}
func Dimensions(w, h int, quality string) (int, int) {
	limit := 1080.
	if quality == "low" {
		limit = 480
	}
	scale := math.Min(1, limit/float64(min(w, h)))
	return max(2, int(float64(w)*scale)/2*2), max(2, int(float64(h)*scale)/2*2)
}
func assTime(ms int64) string {
	return fmt.Sprintf("%d:%02d:%02d.%02d", ms/3600000, (ms/60000)%60, (ms/1000)%60, (ms%1000)/10)
}
func assText(s string) string {
	return strings.NewReplacer("\\", "＼", "{", "｛", "}", "｝", "\r", "", "\n", "\\N").Replace(s)
}
func ASS(s []Segment, w, h int, track string) string {
	font := "Noto Naskh Arabic"
	if track == "fr" {
		font = "Noto Sans"
	}
	factor := .075
	if track == "ar" {
		factor = .12
	}
	size := max(18, int(float64(min(w, h))*factor))
	margin := max(12, w/20)
	out := fmt.Sprintf("[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,%s,%d,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,3,2,0,2,%d,%d,%d,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n", w, h, font, size, margin, margin, max(16, h/20))
	for _, x := range s {
		text := x.Arabic
		if track == "fr" {
			text = x.French
		}
		out += fmt.Sprintf("Dialogue: 0,%s,%s,Default,,0,0,0,,%s\n", assTime(x.Start), assTime(x.End), assText(text))
	}
	return out
}
func (m LocalMedia) Process(ctx context.Context, p MediaRequest, input, output string) (MediaInfo, error) {
	dir, e := os.MkdirTemp("", "tarjama-media-")
	if e != nil {
		return MediaInfo{}, e
	}
	defer os.RemoveAll(dir)
	if input != "" && m.ConsumeInput {
		if e = os.Rename(input, filepath.Join(dir, "input")); e != nil {
			return MediaInfo{}, e
		}
	} else if input != "" {
		in, e := os.Open(input)
		if e != nil {
			return MediaInfo{}, e
		}
		defer in.Close()
		out, e := os.OpenFile(filepath.Join(dir, "input"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return MediaInfo{}, e
		}
		n, e := io.Copy(out, io.LimitReader(in, MaxMediaBytes+1))
		out.Close()
		if e != nil || n > MaxMediaBytes {
			return MediaInfo{}, errors.New("Média trop grand")
		}
	}
	if p.Operation == "download" {
		u, e := VideoURL(p.URL)
		if e != nil {
			return MediaInfo{}, e
		}
		if m.Proxy == "" {
			return MediaInfo{}, &ProviderError{Public: "Sortie WARP non configurée", Temporary: true}
		}
		// All extractor and media requests use the filtering proxy. Container has no direct egress.
		_, e = m.run(ctx, dir, "yt-dlp", "--ignore-config", "--no-playlist", "--no-cache-dir", "--no-progress", "--socket-timeout", "20", "--retries", "2", "--fragment-retries", "2", "--max-filesize", "1G", "--match-filters", "duration <= 10800", "--proxy", m.Proxy, "--js-runtimes", "node", "--format", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mkv", "--output", "input.%(ext)s", "--", u)
		if e != nil {
			return MediaInfo{}, &ProviderError{Public: "Téléchargement indisponible", Temporary: true}
		}
		files, e := filepath.Glob(filepath.Join(dir, "input.*"))
		if e != nil || len(files) != 1 {
			return MediaInfo{}, errors.New("Sortie téléchargement ambiguë")
		}
		if e = os.Rename(files[0], filepath.Join(dir, "input")); e != nil {
			return MediaInfo{}, e
		}
	}
	info, e := m.probe(ctx, dir, "input")
	if e != nil {
		return info, e
	}
	base := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2", "-filter_threads", "1", "-protocol_whitelist", "file,pipe"}
	name := "output.mp4"
	switch p.Operation {
	case "audio":
		if p.Start < 0 || p.Duration <= 0 || p.Duration > 600 || p.Start*1000 >= float64(info.Duration) {
			return info, errors.New("Morceau invalide")
		}
		duration := math.Min(p.Duration, float64(info.Duration)/1000-p.Start)
		for {
			args := append(append([]string{}, base...), "-ss", fmt.Sprint(p.Start), "-t", fmt.Sprint(duration), "-i", "input", "-vn", "-map", "0:a:0", "-ar", "16000", "-ac", "1", "-c:a", "flac", "output.flac")
			if _, e = m.run(ctx, dir, "ffmpeg", args...); e != nil {
				return info, e
			}
			st, e := os.Stat(filepath.Join(dir, "output.flac"))
			if e != nil {
				return info, e
			}
			if st.Size() <= 23*1024*1024 {
				break
			}
			duration = math.Floor(duration * .75)
			if duration < 30 {
				return info, errors.New("Audio trop volumineux")
			}
		}
		name = "output.flac"
		info.ChunkDuration = duration
	case "prepare", "download", "export":
		w, h := Dimensions(info.Width, info.Height, "high")
		filter := fmt.Sprintf("scale=%d:%d,setsar=1", w, h)
		crf := "23"
		if p.Operation == "export" {
			if p.Track != "ar" && p.Track != "fr" {
				return info, errors.New("Piste invalide")
			}
			if p.Quality != "low" && p.Quality != "high" {
				return info, errors.New("Qualité invalide")
			}
			if e = ValidateSegments(p.Segments); e != nil {
				return info, e
			}
			w, h = Dimensions(info.Width, info.Height, p.Quality)
			if p.Quality == "low" {
				crf = "28"
			}
			if e = os.WriteFile(filepath.Join(dir, "subtitles.ass"), []byte(ASS(p.Segments, w, h, p.Track)), 0600); e != nil {
				return info, e
			}
			filter = fmt.Sprintf("scale=%d:%d,setsar=1,ass=subtitles.ass", w, h)
		}
		args := append(base, "-i", "input", "-map", "0:v:0", "-map", "0:a:0", "-vf", filter, "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-map_metadata", "-1", name)
		if _, e = m.run(ctx, dir, "ffmpeg", args...); e != nil {
			return info, e
		}
		info, e = m.probe(ctx, dir, name)
		if e != nil {
			return info, e
		}
	default:
		return info, errors.New("Opération média invalide")
	}
	if m.ConsumeInput { // both paths are private temporaries on the same filesystem
		st, e := os.Stat(filepath.Join(dir, name))
		if e != nil {
			return info, e
		}
		if st.Size() > MaxMediaBytes {
			return info, errors.New("Résultat trop grand")
		}
		return info, os.Rename(filepath.Join(dir, name), output)
	}
	f, e := os.Open(filepath.Join(dir, name))
	if e != nil {
		return info, e
	}
	defer f.Close()
	out, e := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return info, e
	}
	ok := false
	defer func() {
		out.Close()
		if !ok {
			os.Remove(output)
		}
	}()
	n, e := io.Copy(out, io.LimitReader(f, MaxMediaBytes+1))
	if e != nil || n > MaxMediaBytes {
		return info, errors.New("Résultat trop grand")
	}
	e = out.Sync()
	ok = e == nil
	return info, e
}

// Same mandatory preflight for service startup and the explicit preview job.
// No test-mode bypass is accepted by this command.
func CheckMediaSandbox(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	dir, e := os.MkdirTemp("", "sandbox-check-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(dir)
	for _, tool := range []struct{ program, flag string }{{"ffprobe", "-version"}, {"yt-dlp", "--version"}} {
		if _, e = (LocalMedia{}).run(ctx, dir, tool.program, tool.flag); e != nil {
			return errors.New("Sandbox média indisponible : vérifier user namespaces/AppArmor/seccomp et outils avant mise en service")
		}
	}
	return nil
}

func RunMedia(ctx context.Context) error {
	token := secret("MEDIA_TOKEN")
	if len(token) < 32 {
		return errors.New("MEDIA_TOKEN requis")
	}
	mode := os.Getenv("APP_MODE")
	local := LocalMedia{Test: mode == "test", ConsumeInput: true, Proxy: os.Getenv("DOWNLOAD_PROXY")}
	if !local.Test {
		if e := CheckMediaSandbox(ctx); e != nil {
			return e
		}
	}
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8091"
	}
	server := HTTPServer(addr, MediaHandler(local, token))
	server.WriteTimeout = 4 * time.Hour
	go func() { <-ctx.Done(); server.Close() }()
	return server.ListenAndServe()
}

func MediaHandler(local Media, token string) http.Handler {
	var mu sync.Mutex
	m := http.NewServeMux()
	m.HandleFunc("POST /process", func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			http.Error(w, "Refusé", 403)
			return
		}
		if !mu.TryLock() {
			http.Error(w, "Occupé", 429)
			return
		}
		defer mu.Unlock()
		r.Body = http.MaxBytesReader(w, r.Body, MaxMediaBytes+1024*1024)
		form, e := r.MultipartReader()
		if e != nil {
			http.Error(w, "Invalide", 400)
			return
		}
		part, e := form.NextPart()
		if e != nil || part.FormName() != "request" {
			http.Error(w, "Invalide", 400)
			return
		}
		var p MediaRequest
		if json.NewDecoder(io.LimitReader(part, 1024*1024)).Decode(&p) != nil {
			http.Error(w, "Invalide", 400)
			return
		}
		dir, e := os.MkdirTemp("", "media-request-")
		if e != nil {
			http.Error(w, "Indisponible", 503)
			return
		}
		defer os.RemoveAll(dir)
		input := ""
		part, e = form.NextPart()
		if e == nil {
			input = filepath.Join(dir, "upload")
			f, e := os.Create(input)
			if e != nil {
				http.Error(w, "Indisponible", 503)
				return
			}
			_, e = io.Copy(f, part)
			f.Close()
			if e != nil {
				http.Error(w, "Import interrompu", 400)
				return
			}
		}
		output := filepath.Join(dir, "result")
		info, e := local.Process(r.Context(), p, input, output)
		if e != nil {
			var pe *ProviderError
			if errors.As(e, &pe) && pe.Temporary {
				http.Error(w, "Indisponible", 503)
			} else {
				http.Error(w, "Média invalide", 422)
			}
			return
		}
		data, _ := json.Marshal(info)
		w.Header().Set("X-Media-Info", string(data))
		http.ServeFile(w, r, output)
	})

	return m
}
