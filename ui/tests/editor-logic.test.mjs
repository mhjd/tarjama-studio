import assert from "node:assert/strict";
import test from "node:test";
import {
  previewAlignedMarkdown,
  previewTranscriptJson,
  parseMarkdownTimecode,
  projectWorkflowStep,
  searchTranscript,
  stripModelCitationMarkers,
  transcriptFingerprint,
  validateEditorSegments,
} from "../dist-electron/editor-logic.js";

test("project workflow requires both manual review confirmations", () => {
  const state = {
    hasVideo: false,
    hasTranscript: false,
    cleanupImported: false,
    transcriptConfirmed: false,
    hasTranslation: false,
    translationConfirmed: false,
  };
  assert.equal(projectWorkflowStep(state), "video");
  state.hasVideo = true;
  assert.equal(projectWorkflowStep(state), "transcription");
  state.hasTranscript = true;
  assert.equal(projectWorkflowStep(state), "cleanup");
  state.cleanupImported = true;
  assert.equal(projectWorkflowStep(state), "transcript-review");
  state.transcriptConfirmed = true;
  assert.equal(projectWorkflowStep(state), "translation");
  state.hasTranslation = true;
  assert.equal(projectWorkflowStep(state), "translation-review");
  state.translationConfirmed = true;
  assert.equal(projectWorkflowStep(state), "export");
});

function transcript(segments) {
  return { corpus_id: "test", segments };
}

test("fingerprint tracks editable text and timestamps only", () => {
  const value = transcript([{ id: "1", start: 0, end: 2, text: "مرحبا", translation: "Bonjour" }]);
  assert.equal(transcriptFingerprint(value), transcriptFingerprint({ ...value, updated_at: "later" }));
  assert.notEqual(transcriptFingerprint(value), transcriptFingerprint({
    ...value,
    segments: [{ ...value.segments[0], translation: "Salut" }],
  }));
});

test("editor validation reports reversed timestamps and overlaps", () => {
  const issues = validateEditorSegments(transcript([
    { id: "1", start: 0, end: 3, text: "a", translation: "" },
    { id: "2", start: 2.5, end: 2, text: "b", translation: "" },
  ]));
  assert.deepEqual(issues.map((issue) => issue.segmentId), ["2", "2"]);
  assert.match(issues[0].message, /fin/i);
  assert.match(issues[1].message, /Chevauchement/);
});

test("search counts occurrences in source and translation", () => {
  const results = searchTranscript(transcript([
    { id: "1", start: 0, end: 3, text: "Test test", translation: "Un test" },
  ]), "test");
  assert.deepEqual(results, [
    { segmentId: "1", field: "text", offset: 0 },
    { segmentId: "1", field: "text", offset: 5 },
    { segmentId: "1", field: "translation", offset: 3 },
  ]);
});

test("model citation markers are removed without touching readable references", () => {
  const content = [
    "<!-- \uE200filecite\uE202turn0file0\uE201 -->",
    "## 00:00.000 --> 00:03.000",
    "«النص» (سورة يونس، الآية 16). \uE200cite\uE202turn470137search4\uE201 Chers amis.",
  ].join("\n");
  assert.equal(
    stripModelCitationMarkers(content),
    "## 00:00.000 --> 00:03.000\n«النص» (سورة يونس، الآية 16). Chers amis.",
  );
});

test("markdown preview rejects timestamps with a different temporal value", () => {
  const source = transcript([
    { id: "1", start: 0, end: 3.44, text: "a", translation: "" },
    { id: "2", start: 3.44, end: 7, text: "b", translation: "" },
  ]);
  const valid = previewAlignedMarkdown(
    "## 00:00.000 --> 00:03.440\nBonjour\n\n## 00:03.440 --> 00:07.000\nSuite",
    source,
  );
  assert.equal(valid.valid, true);
  assert.equal(valid.alignedCount, 2);
  assert.equal(previewAlignedMarkdown("## 00:00.000 --> 00:03.400\nErreur", source).valid, false);
});

test("markdown timestamps compare normalized hour values", () => {
  const source = transcript([
    { id: "1", start: 3601.12, end: 3661.12, text: "a", translation: "" },
  ]);

  assert.equal(previewAlignedMarkdown("## 1:00:01.120 --> 1:01:01.120\nTexte", source).valid, true);
  assert.equal(previewAlignedMarkdown("## 01:00:01.120 --> 01:01:01.120\nTexte", source).valid, true);
  assert.equal(parseMarkdownTimecode("1:00:01.120"), parseMarkdownTimecode("01:00:01.120"));
  assert.equal(parseMarkdownTimecode("18:45.940"), 1125.94);
});

test("markdown timestamps reject total minutes and out-of-range components", () => {
  const source = transcript([
    { id: "1", start: 3601.12, end: 3661.12, text: "a", translation: "" },
  ]);

  assert.equal(parseMarkdownTimecode("60:01.120"), null);
  assert.equal(parseMarkdownTimecode("00:60:01.120"), null);
  assert.equal(parseMarkdownTimecode("00:00:60.000"), null);
  assert.equal(previewAlignedMarkdown("## 60:01.120 --> 61:01.120\nTexte", source).valid, false);
});

test("JSON preview rejects malformed segment payloads", () => {
  assert.equal(previewTranscriptJson('{"segments":[{"start":0,"end":2,"text":"ok"}]}').valid, true);
  assert.equal(previewTranscriptJson('{"segments":[{"start":0}]}').valid, false);
  assert.equal(previewTranscriptJson('{"segments":[{"start":0,"end":2,"text":"a"},{"start":1.9,"end":3,"text":"b"}]}').valid, false);
  assert.equal(previewTranscriptJson("not json").valid, false);
});
