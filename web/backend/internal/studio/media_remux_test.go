package studio

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const compatibleProbe = `{"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"2.0"},"streams":[{"codec_type":"video","codec_name":"h264","profile":"High","level":40,"width":1920,"height":1080,"pix_fmt":"yuv420p","sample_aspect_ratio":"1:1","field_order":"progressive","avg_frame_rate":"25/1","start_time":"0"},{"codec_type":"audio","codec_name":"aac","profile":"LC","channels":2,"sample_rate":"48000","start_time":"0"}]}`

func TestRemuxCompatibility(t *testing.T) {
	for _, tc := range []struct {
		name, field string
		value       any
		stream      int
	}{
		{"vp9", "codec_name", "vp9", 0}, {"av1", "codec_name", "av1", 0},
		{"10bit", "pix_fmt", "yuv420p10le", 0}, {"444", "pix_fmt", "yuv444p", 0},
		{"profile", "profile", "High 10", 0}, {"level", "level", 51, 0},
		{"interlaced", "field_order", "tt", 0}, {"unknown_interlace", "field_order", "", 0},
		{"sar", "sample_aspect_ratio", "4:3", 0}, {"missing_sar", "sample_aspect_ratio", "", 0},
		{"hdr", "color_transfer", "smpte2084", 0}, {"rotation", "side_data_list", []any{map[string]any{"rotation": 90}}, 0},
		{"tag_rotation", "tags", map[string]string{"rotate": "180"}, 0},
		{"attached", "disposition", map[string]int{"attached_pic": 1}, 0},
		{"resize", "width", 3840, 0}, {"odd", "width", 1919, 0},
		{"fps", "avg_frame_rate", "120/1", 0}, {"nan_fps", "avg_frame_rate", "NaN/1", 0},
		{"unknown_fps", "avg_frame_rate", "0/0", 0}, {"offset", "start_time", "10", 0},
		{"nan_start", "start_time", "NaN", 0}, {"opus", "codec_name", "opus", 1},
		{"he_aac", "profile", "HE-AAC", 1}, {"surround", "channels", 6, 1},
		{"sample_rate", "sample_rate", "96000", 1}, {"missing_audio", "codec_type", "data", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var d map[string]any
			if e := json.Unmarshal([]byte(compatibleProbe), &d); e != nil {
				t.Fatal(e)
			}
			d["streams"].([]any)[tc.stream].(map[string]any)[tc.field] = tc.value
			raw, _ := json.Marshal(d)
			if canRemuxMedia(raw, 1920, 1080) {
				t.Fatal("incompatible media copied")
			}
		})
	}
	for _, format := range []string{"mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm"} {
		raw := strings.Replace(compatibleProbe, "mov,mp4,m4a,3gp,3g2,mj2", format, 1)
		if !canRemuxMedia([]byte(raw), 1920, 1080) {
			t.Fatal("compatible media transcoded", format)
		}
	}
	for _, raw := range []string{"{", strings.Replace(compatibleProbe, "2.0", "NaN", 1), strings.Replace(compatibleProbe, "mov,mp4,m4a,3gp,3g2,mj2", "mpegts", 1)} {
		if canRemuxMedia([]byte(raw), 1920, 1080) {
			t.Fatal("invalid probe copied")
		}
	}
	if canRemuxMedia([]byte(compatibleProbe), 1280, 720) {
		t.Fatal("resizing bypassed")
	}
}

func mediaTestCommand(t *testing.T, program string, args ...string) []byte {
	t.Helper()
	raw, e := exec.Command(program, args...).CombinedOutput()
	if e != nil {
		t.Fatalf("%s failed: %v %s", program, e, raw)
	}
	return raw
}

func TestIsolatedRemuxRealMedia(t *testing.T) {
	if _, e := exec.LookPath("ffmpeg"); e != nil {
		t.Skip("ffmpeg required")
	}
	dir := t.TempDir()
	in, out := filepath.Join(dir, "in"), filepath.Join(dir, "out")
	os.Mkdir(in, 0700)
	os.Mkdir(out, 0700)
	source := filepath.Join(in, "media")
	// Two audio tracks and user metadata must not leak into the prepared MP4.
	mediaTestCommand(t, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=25:d=2", "-f", "lavfi", "-i", "sine=sample_rate=48000:duration=2", "-map", "0:v", "-map", "1:a", "-map", "1:a", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-metadata", "title=PRIVATE-FIXTURE", "-metadata:s:a:0", "title=PRIVATE-TRACK", "-f", "mp4", source)
	probe := mediaTestCommand(t, "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", source)
	if !canRemuxMedia(probe, 160, 90) {
		t.Fatalf("fixture not eligible: %s", probe)
	}
	if e := runIsolatedTool(context.Background(), []string{"normalize", "160", "90", "high"}, in, out); e != nil {
		t.Fatal(e)
	}
	result := filepath.Join(out, "result.mp4")
	resultProbe := mediaTestCommand(t, "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", result)
	if strings.Contains(string(resultProbe), "PRIVATE") {
		t.Fatal("source metadata leaked")
	}
	var d struct {
		Streams []json.RawMessage `json:"streams"`
	}
	json.Unmarshal(resultProbe, &d)
	if len(d.Streams) != 2 {
		t.Fatal("extra tracks copied")
	}
	// Encoded video packets are identical: this proves no generation was encoded.
	packets := func(file, selector string) []string {
		raw := mediaTestCommand(t, "ffprobe", "-v", "error", "-select_streams", selector, "-show_packets", "-show_data_hash", "sha256", "-show_entries", "packet=data_hash", "-of", "json", file)
		var p struct {
			Packets []struct {
				Hash string `json:"data_hash"`
			} `json:"packets"`
		}
		if e := json.Unmarshal(raw, &p); e != nil {
			t.Fatal(e)
		}
		hashes := []string{}
		for _, v := range p.Packets {
			hashes = append(hashes, v.Hash)
		}
		return hashes
	}
	if a, b := packets(source, "v:0"), packets(result, "v:0"); len(a) == 0 || !reflect.DeepEqual(a, b) {
		t.Fatal("video packets changed")
	}
	// Decode both streams fully and verify faststart, not just ffprobe headers.
	mediaTestCommand(t, "ffmpeg", "-v", "error", "-xerror", "-i", result, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-")
	data, _ := os.ReadFile(result)
	if strings.Index(string(data), "moov") > strings.Index(string(data), "mdat") {
		t.Fatal("moov not at start")
	}
	// Export still burns subtitles, but retains the original AAC packets.
	audioBefore := packets(source, "a:0")
	subtitles := ASS([]Segment{{ID: "a", Start: 0, End: 1500, Arabic: "مرحبا", French: "Bonjour à tous."}}, 160, 90, "fr")
	if e := os.WriteFile(filepath.Join(in, "subtitles.ass"), []byte(subtitles), 0600); e != nil {
		t.Fatal(e)
	}
	if e := runIsolatedTool(context.Background(), []string{"export", "160", "90", "high", "4"}, in, out); e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(audioBefore, packets(result, "a:0")) {
		t.Fatal("AAC re-encoded during export")
	}
	if reflect.DeepEqual(packets(source, "v:0"), packets(result, "v:0")) {
		t.Fatal("subtitle burn-in skipped")
	}
	// Muxed YouTube paths use Matroska. Test that exact container too.
	mkv := filepath.Join(dir, "source.mkv")
	mediaTestCommand(t, "ffmpeg", "-v", "error", "-i", source, "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", mkv)
	b, _ := os.ReadFile(mkv)
	os.WriteFile(source, b, 0600)
	if e := runIsolatedTool(context.Background(), []string{"normalize", "160", "90", "high"}, in, out); e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(packets(source, "v:0"), packets(result, "v:0")) {
		t.Fatal("Matroska video re-encoded")
	}
	// H.264 + MP3: keep video packets, convert only the incompatible audio.
	mp3 := filepath.Join(dir, "mp3.mkv")
	mediaTestCommand(t, "ffmpeg", "-v", "error", "-i", source, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-c:a", "libmp3lame", mp3)
	b, _ = os.ReadFile(mp3)
	os.WriteFile(source, b, 0600)
	probe = mediaTestCommand(t, "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", source)
	if !canCopyMediaVideo(probe, 160, 90) || canCopyMediaAudio(probe) {
		t.Fatal("bad partial-copy selection")
	}
	if e := runIsolatedTool(context.Background(), []string{"normalize", "160", "90", "high"}, in, out); e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(packets(source, "v:0"), packets(result, "v:0")) {
		t.Fatal("compatible video re-encoded for incompatible audio")
	}
	normalizedProbe := mediaTestCommand(t, "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", result)
	if !canCopyMediaAudio(normalizedProbe) {
		t.Fatal("audio not converted to AAC")
	}
	// Resize must still use the transcoding path.
	if e := runIsolatedTool(context.Background(), []string{"normalize", "80", "44", "high"}, in, out); e != nil {
		t.Fatal(e)
	}
	resized := mediaTestCommand(t, "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", result)
	info, e := parseMediaProbe(resized)
	if e != nil || info.Width != 80 || info.Height != 44 {
		t.Fatal("resize skipped", info, e)
	}
	// A corrupt source must fail instead of falling back to another expensive run.
	os.WriteFile(source, []byte("not a video"), 0600)
	if e := runIsolatedTool(context.Background(), []string{"normalize", "160", "90", "high"}, in, out); e == nil {
		t.Fatal("corrupt input accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if e := runIsolatedTool(ctx, []string{"normalize", "160", "90", "high"}, in, out); e == nil {
		t.Fatal("cancel ignored")
	}
}

func TestRenderAudioAndAdminThreadLimit(t *testing.T) {
	if !canCopyMediaAudio([]byte(compatibleProbe)) {
		t.Fatal("AAC unnecessarily re-encoded")
	}
	for _, raw := range []string{
		"{}", strings.Replace(compatibleProbe, `"aac"`, `"opus"`, 1),
		strings.Replace(compatibleProbe, `"LC"`, `"HE-AAC"`, 1),
		strings.Replace(compatibleProbe, `"channels":2`, `"channels":6`, 1),
		strings.Replace(compatibleProbe, `"sample_rate":"48000"`, `"sample_rate":"96000"`, 1),
	} {
		if canCopyMediaAudio([]byte(raw)) {
			t.Fatal("incompatible audio copied", raw)
		}
	}
	for _, extra := range []string{"0", "auto", "6", "64", "4;id", "-1"} {
		if _, _, _, _, _, err := isolatedToolCommand([]string{"export", "1920", "1080", "high", extra}, "/inputs", "/outputs"); err == nil {
			t.Fatal("unbounded threads accepted", extra)
		}
	}
	for _, tc := range []struct {
		args    []string
		threads string
	}{
		{[]string{"export", "1920", "1080", "high"}, "2"},
		{[]string{"export", "1920", "1080", "high", "4"}, "4"},
	} {
		if _, _, _, _, _, e := isolatedToolCommand(tc.args, "/inputs", "/outputs"); e != nil {
			t.Fatal(e)
		}
		argv := strings.Join(isolatedRenderArgs(tc.args, "/inputs", "/outputs", true), " ")
		if !strings.Contains(argv, "-c:a copy") || strings.Contains(argv, "-b:a") || !strings.Contains(argv, "-threads "+tc.threads+" -preset") || !strings.Contains(argv, "ass=/inputs/subtitles.ass") {
			t.Fatal("bad render arguments", argv)
		}
	}
}
