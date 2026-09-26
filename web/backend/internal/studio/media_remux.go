package studio

import (
	"encoding/json"
	"strconv"
	"strings"
)

// A deliberately narrow browser-compatible subset. Unknown properties use the
// existing normalization path. Rotation, anamorphic pixels, HDR, resizing and
// alternate codecs must not silently lose the transformations provided by it.
func canRemuxMedia(raw []byte, width, height int) bool {
	return canCopyMediaVideo(raw, width, height) && canCopyMediaAudio(raw)
}

func canCopyMediaVideo(raw []byte, width, height int) bool {
	var data struct {
		Streams []struct {
			Type        string            `json:"codec_type"`
			Codec       string            `json:"codec_name"`
			Profile     string            `json:"profile"`
			Level       int               `json:"level"`
			Width       int               `json:"width"`
			Height      int               `json:"height"`
			Pixels      string            `json:"pix_fmt"`
			SAR         string            `json:"sample_aspect_ratio"`
			FieldOrder  string            `json:"field_order"`
			FrameRate   string            `json:"avg_frame_rate"`
			Transfer    string            `json:"color_transfer"`
			Channels    int               `json:"channels"`
			SampleRate  string            `json:"sample_rate"`
			Start       string            `json:"start_time"`
			SideData    []json.RawMessage `json:"side_data_list"`
			Tags        map[string]string `json:"tags"`
			Disposition struct {
				AttachedPic int `json:"attached_pic"`
			} `json:"disposition"`
		} `json:"streams"`
		Format struct {
			Name string `json:"format_name"`
		} `json:"format"`
	}
	if _, err := parseMediaProbe(raw); err != nil || json.Unmarshal(raw, &data) != nil {
		return false
	}
	if data.Format.Name != "mov,mp4,m4a,3gp,3g2,mj2" && data.Format.Name != "matroska,webm" {
		return false
	}
	if width < 2 || height < 2 || width%2 != 0 || height%2 != 0 || width > 8192 || height > 8192 || min(width, height) > 1080 {
		return false
	}
	for _, s := range data.Streams {
		if s.Type != "video" {
			continue
		}
		// Like -map 0:v:0, inspect only the selected first video track.
		start, err := strconv.ParseFloat(s.Start, 64)
		if err != nil || !(start >= 0 && start <= 0.1) || len(s.SideData) != 0 {
			return false
		}
		for key := range s.Tags {
			if strings.EqualFold(key, "rotate") {
				return false
			}
		}
		if s.Type == "video" {
			profile := s.Profile == "Baseline" || s.Profile == "Constrained Baseline" || s.Profile == "Main" || s.Profile == "High"
			rate := strings.Split(s.FrameRate, "/")
			if len(rate) != 2 {
				return false
			}
			n, en := strconv.ParseFloat(rate[0], 64)
			d, ed := strconv.ParseFloat(rate[1], 64)
			if en != nil || ed != nil || !(d > 0 && n/d > 0 && n/d <= 60) {
				return false
			}
			if s.Codec != "h264" || !profile || s.Level <= 0 || s.Level > 42 || s.Pixels != "yuv420p" || s.SAR != "1:1" || s.FieldOrder != "progressive" || s.Disposition.AttachedPic != 0 || s.Width != width || s.Height != height {
				return false
			}
			if s.Transfer != "" && s.Transfer != "unknown" && s.Transfer != "bt709" {
				return false
			}
			return true
		}
	}
	return false
}

func remuxMediaArgs(input, output string, copyAudio bool) []string {
	// Demux all packets, strip unselected tracks/chapters/metadata and rebuild a
	// seekable MP4 with moov first. Copying the original file is not equivalent.
	// No automatic retry as a transcode on corrupt packets or cancellation.
	argv := []string{"-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-xerror", "-threads", "2", "-protocol_whitelist", "file,pipe", "-i", input,
		"-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy"}
	if copyAudio {
		argv = append(argv, "-c:a", "copy")
	} else {
		argv = append(argv, "-c:a", "aac", "-b:a", "128k")
	}
	return append(argv, "-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1",
		"-disposition:v:0", "default", "-disposition:a:0", "default", "-movflags", "+faststart", output)
}

// Subtitle burn-in changes the picture, not the sound. Copy only a conservative
// AAC-LC subset; all other audio still passes through the existing AAC encoder.
func canCopyMediaAudio(raw []byte) bool {
	var data struct {
		Streams []struct {
			Type       string            `json:"codec_type"`
			Codec      string            `json:"codec_name"`
			Profile    string            `json:"profile"`
			Channels   int               `json:"channels"`
			SampleRate string            `json:"sample_rate"`
			Start      string            `json:"start_time"`
			SideData   []json.RawMessage `json:"side_data_list"`
		} `json:"streams"`
	}
	if json.Unmarshal(raw, &data) != nil {
		return false
	}
	for _, s := range data.Streams {
		if s.Type != "audio" {
			continue
		}
		start, err := strconv.ParseFloat(s.Start, 64)
		return err == nil && start >= 0 && start <= 0.1 && len(s.SideData) == 0 && s.Codec == "aac" && s.Profile == "LC" && s.Channels >= 1 && s.Channels <= 2 && (s.SampleRate == "44100" || s.SampleRate == "48000")
	}
	return false
}
