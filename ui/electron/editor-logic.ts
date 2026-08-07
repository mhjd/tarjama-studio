import type { WorkspaceTranscript } from "./types.js";

export type SegmentIssue = {
  segmentId: string;
  index: number;
  message: string;
};

export type ImportContentPreview = {
  valid: boolean;
  segmentCount: number;
  alignedCount: number;
  errors: string[];
};

export type ProjectWorkflowStep =
  | "video"
  | "transcription"
  | "cleanup"
  | "transcript-review"
  | "translation"
  | "translation-review"
  | "export";

const MODEL_CITATION_MARKER = /\uE200(?:cite|filecite)\uE202[^\uE201\r\n]*\uE201[ \t]*/gu;
const MODEL_CITATION_COMMENT = /<!--\s*\uE200(?:cite|filecite)\uE202[^\uE201\r\n]*\uE201\s*-->[ \t]*(?:\r?\n)?/gu;

export function stripModelCitationMarkers(content: string): string {
  return content
    .replace(MODEL_CITATION_COMMENT, "")
    .replace(MODEL_CITATION_MARKER, "")
    .replace(/[ \t]+(?=\r?$)/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

export function projectWorkflowStep(state: {
  hasVideo: boolean;
  hasTranscript: boolean;
  cleanupImported: boolean;
  transcriptConfirmed: boolean;
  hasTranslation: boolean;
  translationConfirmed: boolean;
}): ProjectWorkflowStep {
  if (!state.hasVideo) return "video";
  if (!state.hasTranscript) return "transcription";
  if (!state.cleanupImported) return "cleanup";
  if (!state.transcriptConfirmed) return "transcript-review";
  if (!state.hasTranslation) return "translation";
  if (!state.translationConfirmed) return "translation-review";
  return "export";
}

const MARKDOWN_TIMESTAMP = /^##\s+(.+?)\s+-->\s+(.+?)\s*$/;
const TIMECODE = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/;

function roundedTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function parseMarkdownTimecode(value: string): number | null {
  const match = value.trim().match(TIMECODE);
  if (!match) return null;
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every(Number.isFinite) || minutes >= 60 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function transcriptFingerprint(transcript: WorkspaceTranscript | null): string {
  if (!transcript) return "";
  return JSON.stringify(transcript.segments.map((segment) => ({
    id: String(segment.id),
    start: roundedTime(segment.start),
    end: roundedTime(segment.end),
    text: segment.text,
    translation: segment.translation,
  })));
}

export function validateEditorSegments(transcript: WorkspaceTranscript | null): SegmentIssue[] {
  if (!transcript) return [];
  const issues: SegmentIssue[] = [];
  transcript.segments.forEach((segment, index) => {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)) {
      issues.push({ segmentId: segment.id, index, message: "Horodatage invalide" });
      return;
    }
    if (segment.start < 0) {
      issues.push({ segmentId: segment.id, index, message: "Le début ne peut pas être négatif" });
    }
    if (segment.end <= segment.start) {
      issues.push({ segmentId: segment.id, index, message: "La fin doit être postérieure au début" });
    }
    const previous = transcript.segments[index - 1];
    if (previous && segment.start < previous.end - 0.001) {
      issues.push({
        segmentId: segment.id,
        index,
        message: `Chevauchement avec le segment précédent (fin ${formatPreciseTime(previous.end)})`,
      });
    }
  });
  return issues;
}

export function searchTranscript(
  transcript: WorkspaceTranscript | null,
  query: string,
): Array<{ segmentId: string; field: "text" | "translation"; offset: number }> {
  const needle = query.trim().toLocaleLowerCase();
  if (!transcript || !needle) return [];
  const results: Array<{ segmentId: string; field: "text" | "translation"; offset: number }> = [];
  for (const segment of transcript.segments) {
    for (const field of ["text", "translation"] as const) {
      const haystack = segment[field].toLocaleLowerCase();
      let offset = 0;
      while ((offset = haystack.indexOf(needle, offset)) >= 0) {
        results.push({ segmentId: segment.id, field, offset });
        offset += Math.max(1, needle.length);
      }
    }
  }
  return results;
}

export function formatPreciseTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--.---";
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  const clock = hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${clock}.${String(millis).padStart(3, "0")}`;
}

function markdownHeaders(content: string): string[] {
  return content.split(/\r?\n/).filter((line) => line.trimStart().startsWith("## "));
}

export function previewAlignedMarkdown(
  content: string,
  transcript: WorkspaceTranscript,
): ImportContentPreview {
  const headers = markdownHeaders(content);
  const errors: string[] = [];
  let alignedCount = 0;
  headers.forEach((header, index) => {
    const match = header.match(MARKDOWN_TIMESTAMP);
    if (!match) {
      errors.push(`Bloc ${index + 1}: titre invalide (${header.slice(0, 100)})`);
      return;
    }
    const receivedStart = parseMarkdownTimecode(match[1]);
    const receivedEnd = parseMarkdownTimecode(match[2]);
    if (receivedStart === null || receivedEnd === null) {
      errors.push(`Bloc ${index + 1}: titre invalide (${header.slice(0, 100)})`);
      return;
    }
    const expected = transcript.segments[index];
    if (!expected) return;
    const expectedHeader = `## ${formatPreciseTime(expected.start)} --> ${formatPreciseTime(expected.end)}`;
    if (roundedTime(receivedStart) === roundedTime(expected.start) && roundedTime(receivedEnd) === roundedTime(expected.end)) {
      alignedCount += 1;
    }
    else errors.push(`Bloc ${index + 1}: attendu ${expectedHeader}; reçu ${header.trim()}`);
  });
  if (headers.length !== transcript.segments.length) {
    errors.push(`${headers.length} bloc(s) reçu(s), ${transcript.segments.length} attendu(s)`);
  }
  return {
    valid: errors.length === 0,
    segmentCount: headers.length,
    alignedCount,
    errors: errors.slice(0, 8),
  };
}

export function previewTranscriptJson(content: string): ImportContentPreview {
  try {
    const payload = JSON.parse(content) as { segments?: unknown };
    if (!Array.isArray(payload.segments)) {
      return { valid: false, segmentCount: 0, alignedCount: 0, errors: ["Le JSON ne contient pas de tableau segments"] };
    }
    const segments = payload.segments;
    const errors: string[] = [];
    segments.forEach((value, index) => {
      const segment = value as Record<string, unknown>;
      const start = Number(segment.start);
      const end = Number(segment.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        errors.push(`Segment ${index + 1}: timestamps absents ou invalides`);
      }
      if (typeof segment.text !== "string") errors.push(`Segment ${index + 1}: texte absent`);
      const previous = segments[index - 1] as Record<string, unknown> | undefined;
      if (previous && start < Number(previous.end)) {
        errors.push(`Segment ${index + 1}: chevauche le segment précédent`);
      }
    });
    return {
      valid: errors.length === 0,
      segmentCount: segments.length,
      alignedCount: segments.length,
      errors: errors.slice(0, 8),
    };
  } catch (error) {
    return {
      valid: false,
      segmentCount: 0,
      alignedCount: 0,
      errors: [`JSON invalide: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
