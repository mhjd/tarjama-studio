package studio

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode"
)

// RunIsolatedTool is an administrator profile entrypoint, NEVER a Media fallback.
// The broker must provide network-none, dedicated inputs/output tmpfs, UID,
// capabilities/seccomp/AppArmor/NNP and cgroup limits before invoking this mode.
// No DB/config/secret loader is called here. Paths are fixed in the CLI contract.
func RunIsolatedTool(ctx context.Context, args []string) error {
	return runIsolatedTool(ctx, args, "/inputs", "/outputs")
}

func runIsolatedTool(ctx context.Context, args []string, in, out string) error {
	program, argv, result, limit, timeout, e := isolatedToolCommand(args, in, out)
	if e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "prlimit", append([]string{"--fsize=1073741824", "--cpu=14400", "--nofile=128", "--", program}, argv...)...)
	cmd.Dir = out
	cmd.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "LANG=C.UTF-8"}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = time.Second
	stdout := &limitedBuffer{Limit: 1024 * 1024}
	stderr := &limitedBuffer{Limit: 32 * 1024}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if e = cmd.Run(); e != nil {
		// Download has only a canonical public URL as input and no app secrets.
		// Keep its bounded, redacted tail in the private broker diagnostic, not
		// application logs. Other tools may echo user file contents: do not dump them.
		if args[0] == "download" {
			fmt.Fprintln(os.Stderr, safeDownloadDiagnostic(stderr.String()))
		}
		return fmt.Errorf("Outil isolé en échec (error_category=%s)", isolatedFailureReason(stderr.String()))
	}
	if args[0] == "probe" {
		if e = os.WriteFile(result, stdout.Bytes(), 0600); e != nil {
			return e
		}
	}
	st, e := os.Lstat(result)
	if e != nil || !st.Mode().IsRegular() || st.Size() <= 0 || st.Size() > limit {
		return errors.New("Sortie isolée invalide ou hors limites")
	}
	return nil
}

func isolatedToolCommand(args []string, in, out string) (program string, argv []string, result string, limit int64, timeout time.Duration, err error) {
	bad := errors.New("Paramètres du profil isolé invalides")
	err = bad
	if len(args) == 0 {
		return
	}
	media := filepath.Join(in, "media")
	program = "ffmpeg"
	limit = MaxMediaBytes
	timeout = 4 * time.Hour
	base := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-threads", "2", "-filter_threads", "1", "-protocol_whitelist", "file,pipe"}
	integer := func(s string, low, high int64) (int64, bool) {
		n, e := strconv.ParseInt(s, 10, 64)
		return n, e == nil && n >= low && n <= high && strconv.FormatInt(n, 10) == s
	}
	switch args[0] {
	case "probe":
		if len(args) != 1 {
			return
		}
		program = "ffprobe"
		timeout = 30 * time.Second
		limit = 1024 * 1024
		result = filepath.Join(out, "stdout")
		argv = []string{"-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", media}
	case "audio":
		if len(args) != 3 {
			return
		}
		start, ok := integer(args[1], 0, 10800000)
		if !ok {
			return
		}
		duration, ok := integer(args[2], 1, 600000)
		if !ok {
			return
		}
		limit = 23 * 1024 * 1024
		result = filepath.Join(out, "audio.flac")
		argv = append(base, "-ss", fmt.Sprintf("%.3f", float64(start)/1000), "-t", fmt.Sprintf("%.3f", float64(duration)/1000), "-i", media, "-vn", "-map", "0:a:0", "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", "-c:a", "flac", result)
	case "normalize", "export":
		if len(args) != 4 {
			return
		}
		w, ok := integer(args[1], 2, 8192)
		if !ok || w%2 != 0 {
			return
		}
		h, ok := integer(args[2], 2, 8192)
		if !ok || h%2 != 0 {
			return
		}
		quality := args[3]
		if quality != "low" && quality != "high" {
			return
		}
		if args[0] == "normalize" && quality != "high" {
			return
		}
		filter := fmt.Sprintf("scale=%d:%d,setsar=1", w, h)
		crf := "23"
		if args[0] == "export" {
			filter += ",ass=" + filepath.Join(in, "subtitles.ass")
			if quality == "low" {
				crf = "28"
			}
		}
		result = filepath.Join(out, "result.mp4")
		argv = append(base, "-i", media, "-map", "0:v:0", "-map", "0:a:0", "-vf", filter, "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", crf, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-map_metadata", "-1", result)
	case "mux":
		if len(args) != 1 {
			return
		}
		result = filepath.Join(out, "result.mkv")
		argv = append(base, "-i", media, "-protocol_whitelist", "file,pipe", "-i", filepath.Join(in, "audio"), "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-map_metadata", "-1", result)
	case "download":
		if len(args) != 3 {
			return
		}
		u, e := VideoURL(args[1])
		if e != nil || u != args[1] {
			return
		}
		format := "bv*[height<=1080][protocol=https]/b[height<=1080][protocol=https]"
		if args[2] == "audio" {
			format = "ba[protocol=https]/b[height<=1080][protocol=https]"
		} else if args[2] != "video" {
			return
		}
		program = "yt-dlp"
		timeout = 30 * time.Minute
		result = filepath.Join(out, "media")
		// Fixed loopback relay endpoint, administered per profile. No environment
		// proxy, external downloader, FFmpeg fixup/merge or direct fallback.
		argv = []string{"--ignore-config", "--no-playlist", "--no-cache-dir", "--no-progress", "--no-warnings", "--no-exec", "--socket-timeout", "20", "--retries", "2", "--fragment-retries", "2", "--max-filesize", "1G", "--match-filters", "duration <= 10800 & !is_live", "--proxy", "http://127.0.0.1:18080", "--js-runtimes", "node", "--downloader", "native", "--fixup", "never", "--ffmpeg-location", "/nonexistent", "--format", format, "--output", result, "--", u}
	default:
		return
	}
	err = nil
	return
}

var diagnosticURL = regexp.MustCompile(`(?i)https?://[^\s"<>]+`)

func safeDownloadDiagnostic(raw string) string {
	raw = diagnosticURL.ReplaceAllString(raw, "[URL]")
	lines := strings.Split(raw, "\n")
	for i, line := range lines {
		lower := strings.ToLower(line)
		for _, marker := range []string{"authorization", "cookie", "api_key", "api-key", "bearer "} {
			if strings.Contains(lower, marker) {
				lines[i] = "[credential-bearing line redacted]"
				break
			}
		}
	}
	cleaned := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, strings.Join(lines, "\n"))
	if len(cleaned) > 4096 {
		cleaned = cleaned[len(cleaned)-4096:]
	}
	return cleaned
}
