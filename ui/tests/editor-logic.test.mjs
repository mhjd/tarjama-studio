import assert from "node:assert/strict";
import test from "node:test";
import {
  previewAlignedMarkdown,
  previewTranscriptJson,
  projectWorkflowStep,
  searchTranscript,
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

test("markdown preview requires exact source timestamps", () => {
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

test("JSON preview rejects malformed segment payloads", () => {
  assert.equal(previewTranscriptJson('{"segments":[{"start":0,"end":2,"text":"ok"}]}').valid, true);
  assert.equal(previewTranscriptJson('{"segments":[{"start":0}]}').valid, false);
  assert.equal(previewTranscriptJson('{"segments":[{"start":0,"end":2,"text":"a"},{"start":1.9,"end":3,"text":"b"}]}').valid, false);
  assert.equal(previewTranscriptJson("not json").valid, false);
});
