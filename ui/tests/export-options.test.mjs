import assert from "node:assert/strict";
import test from "node:test";
import {
  groupExportCues,
  normalizeExportOptions,
  outputDimensions,
  subtitleFontSize,
  videoEncodingArguments,
} from "../dist-electron/export-options.js";

test("export options reject unknown renderer values", () => {
  assert.deepEqual(normalizeExportOptions({
    style: "invalid",
    subtitleSize: "huge",
    videoQuality: "8k",
    cueGrouping: "unsafe",
    minimumWords: 500,
  }), {
    style: "black-band",
    subtitleSize: "standard",
    videoQuality: "mobile-720p",
    cueGrouping: "automatic",
    minimumWords: undefined,
  });
  assert.equal(normalizeExportOptions({ cueGrouping: "minimum-words", minimumWords: 500 }).minimumWords, 30);
});

test("mobile dimensions preserve aspect ratio and never upscale", () => {
  assert.deepEqual(outputDimensions({ width: 1920, height: 1080 }, "mobile-720p"), { width: 1280, height: 720 });
  assert.deepEqual(outputDimensions({ width: 1080, height: 1920 }, "mobile-720p"), { width: 720, height: 1280 });
  assert.deepEqual(outputDimensions({ width: 640, height: 360 }, "mobile-720p"), { width: 640, height: 360 });
  assert.deepEqual(outputDimensions({ width: 1920, height: 1080 }, "compact-480p"), { width: 854, height: 480 });
});

test("subtitle size follows the short edge of every aspect ratio", () => {
  assert.equal(subtitleFontSize({ width: 1280, height: 720 }, "standard"), 48);
  assert.equal(subtitleFontSize({ width: 720, height: 1280 }, "standard"), 48);
  assert.equal(subtitleFontSize({ width: 1280, height: 720 }, "compact"), 41);
  assert.equal(subtitleFontSize({ width: 1280, height: 720 }, "large"), 55);
});

test("automatic grouping merges flashes but respects gaps and reading limits", () => {
  const merged = groupExportCues([
    { start: 0, end: 0.7, text: "En effet" },
    { start: 0.75, end: 3.5, text: "cette explication reste nécessaire." },
  ], "automatic");
  assert.deepEqual(merged, [
    { start: 0, end: 3.5, text: "En effet cette explication reste nécessaire." },
  ]);

  const separated = groupExportCues([
    { start: 0, end: 0.7, text: "En effet" },
    { start: 1.3, end: 4, text: "cette explication arrive après une pause." },
  ], "automatic");
  assert.equal(separated.length, 2);

  const tooFast = groupExportCues([
    { start: 0, end: 0.5, text: "Oui" },
    { start: 0.5, end: 1, text: "Cette phrase est beaucoup trop longue pour être fusionnée et lue correctement." },
  ], "automatic");
  assert.equal(tooFast.length, 2);
});

test("custom grouping honors the requested word target within safety limits", () => {
  const grouped = groupExportCues([
    { start: 0, end: 1.5, text: "Une courte" },
    { start: 1.5, end: 3.5, text: "phrase suivante" },
    { start: 3.5, end: 5, text: "Fin" },
  ], "minimum-words", 4);
  assert.deepEqual(grouped, [
    { start: 0, end: 5, text: "Une courte phrase suivante Fin" },
  ]);
});

test("all MP4 presets use compatible AAC audio settings", () => {
  assert.deepEqual(videoEncodingArguments("original"), ["-crf", "23", "-c:a", "aac", "-b:a", "128k"]);
  assert.deepEqual(videoEncodingArguments("mobile-720p"), ["-crf", "26", "-c:a", "aac", "-b:a", "96k"]);
  assert.deepEqual(videoEncodingArguments("compact-480p"), ["-crf", "29", "-c:a", "aac", "-b:a", "72k"]);
});
