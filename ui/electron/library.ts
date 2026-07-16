import { app, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  CreateYoutubeProjectRequest,
  CreateYoutubeProjectResult,
  CreateLocalProjectResult,
  CleanedTranscriptImportResult,
  DesktopPromptSettings,
  DesktopExportResult,
  DesktopLibraryInfo,
  DesktopProject,
  DesktopProjectLoad,
  DesktopSnapshotInfo,
  ExportProgress,
  ExportVideoOptions,
  ExportSubtitleStyle,
  ExportSubtitleTrack,
  DownloadProgress,
  DownloadYoutubeRequest,
  DownloadYoutubeResult,
  ImportTranslationResult,
  ImportTranscriptResult,
  PromptKind,
  TranscriptSegment,
  UpdateToolResult,
  WorkspaceTranscript,
  WorkspaceTranslation,
  YoutubeFormatOption,
  YoutubeFormatsResult,
} from "./types.js";
import { assertSafeProjectId, assertSafeSnapshotId, safeFormatSelector, safeRemoteUrl } from "./security.js";
import {
  groupExportCues,
  normalizeExportOptions,
  outputDimensions,
  subtitleFontSize,
  videoEncodingArguments,
  type ExportCue,
  type VideoDimensions,
} from "./export-options.js";

const PROJECT_FILE = "project.json";
const TRANSCRIPT_FILE = "transcript.json";
const CURRENT_FILE = "current.json";
const TRANSLATION_FILE = "translation.json";
const ARABIC_SUBTITLE_FONT_NAME = "Noto Naskh Arabic";
const LATIN_SUBTITLE_FONT_NAME = "Arial";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_TEXT_IMPORT_BYTES = 25 * 1024 * 1024;
const MAX_PROMPT_BYTES = 512 * 1024;
const MAX_TRANSCRIPT_SEGMENTS = 100_000;
const MAX_SEGMENT_TEXT_LENGTH = 1_000_000;
const MAX_TOOL_OUTPUT_BYTES = 20 * 1024 * 1024;

export function libraryDir(): string {
  return path.join(app.getPath("userData"), "projects");
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return slug || "project";
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

async function realOrResolved(value: string): Promise<string> {
  try {
    return await fs.realpath(value);
  } catch {
    return path.resolve(value);
  }
}

async function assertInsideLibrary(targetPath: string): Promise<void> {
  const root = await realOrResolved(libraryDir());
  const target = await realOrResolved(targetPath);
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to operate outside Tarjama Studio library");
  }
}

async function removeGeneratedSourceFiles(dir: string): Promise<void> {
  await assertInsideLibrary(dir);
  if (!(await pathExists(dir))) return;
  const entries = await fs.readdir(dir);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith("source."))
      .map(async (entry) => {
        const target = path.join(dir, entry);
        await assertInsideLibrary(target);
        await fs.unlink(target).catch(() => undefined);
      }),
  );
}

function projectDir(projectId: string): string {
  assertSafeProjectId(projectId);
  return path.join(libraryDir(), projectId);
}

function projectFile(projectId: string): string {
  return path.join(projectDir(projectId), PROJECT_FILE);
}

function transcriptFile(projectId: string): string {
  return path.join(projectDir(projectId), TRANSCRIPT_FILE);
}

function currentFile(projectId: string): string {
  return path.join(projectDir(projectId), CURRENT_FILE);
}

function snapshotsDir(projectId: string): string {
  return path.join(projectDir(projectId), "snapshots");
}

function translationFile(projectId: string): string {
  return path.join(projectDir(projectId), TRANSLATION_FILE);
}

function translationSnapshotsDir(projectId: string): string {
  return path.join(projectDir(projectId), "translation_snapshots");
}

function exportsDir(projectId: string): string {
  return path.join(projectDir(projectId), "exports");
}

function projectMediaUrl(projectId: string): string {
  assertSafeProjectId(projectId);
  return `tarjama://app/media/${encodeURIComponent(projectId)}`;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

function assertTextSize(content: string, maximumBytes = MAX_TEXT_IMPORT_BYTES): void {
  if (Buffer.byteLength(content, "utf8") > maximumBytes) {
    throw new Error(`Le fichier texte dépasse la limite de ${Math.floor(maximumBytes / 1024 / 1024)} Mo`);
  }
}

async function readTextFileLimited(filePath: string, maximumBytes = MAX_TEXT_IMPORT_BYTES): Promise<string> {
  const metadata = await fs.stat(filePath);
  if (!metadata.isFile() || metadata.size > maximumBytes) {
    throw new Error(`Le fichier sélectionné dépasse la limite de ${Math.floor(maximumBytes / 1024 / 1024)} Mo`);
  }
  return await fs.readFile(filePath, "utf8");
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeProject(project: DesktopProject): Promise<void> {
  await writeJson(projectFile(project.id), project);
}

async function requireProjectVideo(project: DesktopProject): Promise<string> {
  if (!project.videoPath || !(await pathExists(project.videoPath))) {
    throw new Error("Ajoute d'abord une vidéo au projet");
  }
  await assertInsideLibrary(project.videoPath);
  return project.videoPath;
}

function validateTranscript(payload: unknown): WorkspaceTranscript {
  if (!payload || typeof payload !== "object") {
    throw new Error("Transcript must be a JSON object");
  }
  const transcript = payload as WorkspaceTranscript;
  if (!Array.isArray(transcript.segments) || transcript.segments.length === 0) {
    throw new Error("Transcript must contain at least one segment");
  }
  if (transcript.segments.length > MAX_TRANSCRIPT_SEGMENTS) {
    throw new Error(`Transcript contains too many segments (maximum ${MAX_TRANSCRIPT_SEGMENTS})`);
  }
  let previousStart = -1;
  const ids = new Set<string>();
  transcript.segments.forEach((segment, index) => {
    if (!segment || typeof segment !== "object") {
      throw new Error(`Segment ${index} must be an object`);
    }
    const id = String(segment.id ?? "").trim();
    if (!id) throw new Error(`Segment ${index} has an empty id`);
    if (ids.has(id)) throw new Error(`Duplicate segment id: ${id}`);
    ids.add(id);
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      throw new Error(`Segment ${index} has invalid timestamps`);
    }
    if (start < previousStart) {
      throw new Error(`Segment ${index} starts before the previous segment`);
    }
    previousStart = start;
    if (typeof segment.text !== "string") {
      throw new Error(`Segment ${index} text must be a string`);
    }
    if (typeof segment.translation !== "string") {
      throw new Error(`Segment ${index} translation must be a string`);
    }
    if (segment.text.length > MAX_SEGMENT_TEXT_LENGTH || segment.translation.length > MAX_SEGMENT_TEXT_LENGTH) {
      throw new Error(`Segment ${index} text is unreasonably large`);
    }
  });
  return transcript;
}

function validateCleanedTranscript(
  current: WorkspaceTranscript,
  payload: unknown,
): { transcript: WorkspaceTranscript; summary: Omit<CleanedTranscriptImportResult, "loaded"> } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("La transcription nettoyée doit être un objet JSON");
  }
  const cleaned = payload as WorkspaceTranscript;
  const currentKeys = Object.keys(current).sort();
  const cleanedKeys = Object.keys(cleaned).sort();
  if (JSON.stringify(currentKeys) !== JSON.stringify(cleanedKeys)) {
    const missing = currentKeys.filter((key) => !cleanedKeys.includes(key));
    const extra = cleanedKeys.filter((key) => !currentKeys.includes(key));
    throw new Error(`Les clés principales ont changé. Manquantes: ${missing.join(", ") || "aucune"}; ajoutées: ${extra.join(", ") || "aucune"}`);
  }
  for (const key of ["corpus_id", "audio_path", "source_transcript", "source_model", "project_instructions", "created_at", "updated_at"] as const) {
    if (key in current && cleaned[key] !== current[key]) {
      throw new Error(`Le champ protégé ${key} a été modifié`);
    }
  }
  const transcript = validateTranscript(cleaned);
  const requiredSegmentKeys = ["end", "id", "start", "text", "translation"];
  transcript.segments.forEach((segment, index) => {
    const keys = Object.keys(segment).sort();
    if (JSON.stringify(keys) !== JSON.stringify(requiredSegmentKeys)) {
      throw new Error(`Les clés du segment ${index} ont changé`);
    }
    if (!segment.text.trim()) throw new Error(`Le segment ${index} est vide`);
  });
  const beforeById = new Map(current.segments.map((segment) => [String(segment.id), segment]));
  const afterById = new Map(transcript.segments.map((segment) => [String(segment.id), segment]));
  const keptIds = [...beforeById.keys()].filter((id) => afterById.has(id));
  return {
    transcript,
    summary: {
      before: current.segments.length,
      after: transcript.segments.length,
      added: [...afterById.keys()].filter((id) => !beforeById.has(id)).length,
      removed: [...beforeById.keys()].filter((id) => !afterById.has(id)).length,
      changed: keptIds.filter((id) => beforeById.get(id)?.text !== afterById.get(id)?.text).length,
    },
  };
}

function cleanedTranscriptFromMarkdown(
  projectId: string,
  current: WorkspaceTranscript,
  content: string,
): { transcript: WorkspaceTranscript; summary: Omit<CleanedTranscriptImportResult, "loaded"> } {
  const { sections } = parseTimestampedMarkdown(content);
  if (!sections.length) throw new Error("La transcription nettoyée ne contient aucun bloc Markdown horodaté");
  const sourceByTimestamp = new Map(
    current.segments.map((segment, index) => [timestampKey(segment.start, segment.end), { segment, index }]),
  );
  const usedSourceIds = new Set<string>();
  const mismatches: Array<{ index: number; received?: { start: number; end: number; text: string } }> = [];
  let previousSourceIndex = -1;
  const segments = sections.map((section, sectionIndex) => {
    const source = sourceByTimestamp.get(timestampKey(section.start, section.end));
    if (!source || usedSourceIds.has(String(source.segment.id))) {
      mismatches.push({ index: source?.index ?? sectionIndex, received: section });
      return null;
    }
    usedSourceIds.add(String(source.segment.id));
    if (source.index < previousSourceIndex) {
      throw new Error(
        `Les blocs ne sont plus dans l'ordre à la ligne ${section.headingLine}: ## ${timestampRange(section.start, section.end)}`,
      );
    }
    previousSourceIndex = source.index;
    if (!section.text.trim()) {
      throw new Error(`Le bloc à la ligne ${section.headingLine} est vide: ## ${timestampRange(section.start, section.end)}`);
    }
    return { ...source.segment, text: section.text.trim(), translation: "" };
  });
  if (mismatches.length) {
    throw alignmentError(
      "Bloc de transcription inconnu ou dupliqué",
      current,
      mismatches,
    );
  }
  const transcript = validateTranscript({
    ...current,
    corpus_id: projectId,
    segments: segments.filter((segment): segment is TranscriptSegment => segment !== null),
    updated_at: nowIso(),
  });
  const beforeById = new Map(current.segments.map((segment) => [String(segment.id), segment]));
  const afterById = new Map(transcript.segments.map((segment) => [String(segment.id), segment]));
  const keptIds = [...beforeById.keys()].filter((id) => afterById.has(id));
  return {
    transcript,
    summary: {
      before: current.segments.length,
      after: transcript.segments.length,
      added: 0,
      removed: [...beforeById.keys()].filter((id) => !afterById.has(id)).length,
      changed: keptIds.filter((id) => beforeById.get(id)?.text !== afterById.get(id)?.text).length,
    },
  };
}

function transcriptComparable(transcript: WorkspaceTranscript | null): string {
  if (!transcript) return "";
  return JSON.stringify(
    {
      segments: transcript.segments.map((segment) => ({
        id: String(segment.id),
        start: Number(segment.start.toFixed(3)),
        end: Number(segment.end.toFixed(3)),
        text: segment.text.trim(),
        translation: segment.translation.trim(),
      })),
    },
    null,
    0,
  );
}

function transcriptsDiffer(left: WorkspaceTranscript | null, right: WorkspaceTranscript | null): boolean {
  return transcriptComparable(left) !== transcriptComparable(right);
}

function transcriptWithoutSegmentTranslations(transcript: WorkspaceTranscript): WorkspaceTranscript {
  return {
    ...transcript,
    segments: transcript.segments.map((segment) => ({ ...segment, translation: "" })),
  };
}

function transcriptHasSegmentTranslations(transcript: WorkspaceTranscript): boolean {
  return transcript.segments.some((segment) => segment.translation.trim().length > 0);
}

function transcriptWithTranslation(
  transcript: WorkspaceTranscript | null,
  translation: WorkspaceTranslation | null,
): WorkspaceTranscript | null {
  if (!transcript) return null;
  if (!translation) return transcript;
  const byId = new Map(translation.segments.map((segment) => [segment.id, segment.translation]));
  return {
    ...transcript,
    segments: transcript.segments.map((segment) => ({
      ...segment,
      translation: byId.get(segment.id) ?? "",
    })),
  };
}

function translationFromTranscriptSnapshot(
  projectId: string,
  transcript: WorkspaceTranscript,
): WorkspaceTranslation {
  return {
    corpus_id: projectId,
    language: "fr",
    format: "tarjama-translation-v1",
    source_transcript_fingerprint: transcriptAlignmentFingerprint(transcript),
    imported_from: "snapshot",
    segments: transcript.segments.map((segment) => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      translation: segment.translation,
    })),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

function transcriptAlignmentFingerprint(transcript: WorkspaceTranscript): string {
  return JSON.stringify(
    transcript.segments.map((segment) => ({
      id: String(segment.id),
      start: Number(segment.start.toFixed(3)),
      end: Number(segment.end.toFixed(3)),
    })),
  );
}

function filenameTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function writeSnapshot(projectId: string, transcript: WorkspaceTranscript, prefix = "save"): Promise<string> {
  const snapshot = structuredClone(transcript) as WorkspaceTranscript & { snapshot_at?: string };
  snapshot.corpus_id = projectId;
  snapshot.snapshot_at = nowIso();
  const dir = snapshotsDir(projectId);
  let out = path.join(dir, `${prefix}_${filenameTimestamp()}.json`);
  let index = 1;
  while (await pathExists(out)) {
    out = path.join(dir, `${prefix}_${filenameTimestamp()}_${index}.json`);
    index += 1;
  }
  await writeJson(out, snapshot);
  return out;
}

async function writeTranslationSnapshot(
  projectId: string,
  translation: WorkspaceTranslation,
  prefix = "save",
): Promise<string> {
  const snapshot = structuredClone(translation) as WorkspaceTranslation & { snapshot_at?: string };
  snapshot.corpus_id = projectId;
  snapshot.snapshot_at = nowIso();
  const dir = translationSnapshotsDir(projectId);
  let out = path.join(dir, `${prefix}_${filenameTimestamp()}.json`);
  let index = 1;
  while (await pathExists(out)) {
    out = path.join(dir, `${prefix}_${filenameTimestamp()}_${index}.json`);
    index += 1;
  }
  await writeJson(out, snapshot);
  return out;
}

async function snapshotFiles(projectId: string): Promise<string[]> {
  const dir = snapshotsDir(projectId);
  if (!(await pathExists(dir))) return [];
  const entries = await fs.readdir(dir);
  return entries
    .filter((entry) => entry.endsWith(".json") && !entry.startsWith(("legacy_" as string)))
    .sort()
    .map((entry) => path.join(dir, entry));
}

async function latestSnapshot(projectId: string): Promise<string | null> {
  const files = await snapshotFiles(projectId);
  return files.at(-1) ?? null;
}

function snapshotInfo(filePath: string, current: WorkspaceTranscript | null): Promise<DesktopSnapshotInfo> {
  return readJson<WorkspaceTranscript & { snapshot_at?: string }>(filePath).then((snapshot) => ({
    id: path.basename(filePath),
    created_at: snapshot.snapshot_at ?? snapshot.updated_at ?? snapshot.created_at ?? null,
    segment_count: snapshot.segments.length,
    matches_current: current ? !transcriptsDiffer(current, snapshot) : false,
  }));
}

async function listSnapshotInfo(projectId: string, current: WorkspaceTranscript | null): Promise<DesktopSnapshotInfo[]> {
  return await Promise.all((await snapshotFiles(projectId)).map((filePath) => snapshotInfo(filePath, current)));
}

async function loadSavedTranscript(projectId: string): Promise<WorkspaceTranscript | null> {
  const current = currentFile(projectId);
  const saved = transcriptFile(projectId);
  if (await pathExists(current)) return validateTranscript(await readJson<WorkspaceTranscript>(current));
  if (await pathExists(saved)) return validateTranscript(await readJson<WorkspaceTranscript>(saved));
  return null;
}

async function storedProjectVideo(projectId: string): Promise<string | undefined> {
  const dir = projectDir(projectId);
  if (!(await pathExists(dir))) return undefined;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const source = entries.find((entry) => entry.isFile() && entry.name.startsWith("source."));
  return source ? path.join(dir, source.name) : undefined;
}

async function refreshProjectArtifactPaths(project: DesktopProject): Promise<DesktopProject> {
  const savedTranscript = transcriptFile(project.id);
  const currentTranscript = currentFile(project.id);
  const translation = translationFile(project.id);
  const transcriptPath = (await pathExists(savedTranscript))
    ? savedTranscript
    : (await pathExists(currentTranscript))
      ? currentTranscript
      : undefined;
  const translationPath = (await pathExists(translation)) ? translation : undefined;
  let videoPath = project.videoPath;
  if (videoPath) {
    try {
      await assertInsideLibrary(videoPath);
      if (!(await pathExists(videoPath))) videoPath = undefined;
    } catch {
      videoPath = undefined;
    }
  }
  videoPath ??= await storedProjectVideo(project.id);
  if (
    project.transcriptPath === transcriptPath &&
    project.translationPath === translationPath &&
    project.videoPath === videoPath
  ) return project;
  const updated = { ...project, videoPath, transcriptPath, translationPath };
  await writeProject(updated);
  return updated;
}

async function ensureInitialSnapshot(projectId: string, transcript: WorkspaceTranscript): Promise<void> {
  if ((await snapshotFiles(projectId)).length === 0) {
    await writeSnapshot(projectId, transcript, "initial");
  }
}

async function recoveryState(projectId: string): Promise<DesktopProjectLoad["recovery"]> {
  const currentPath = currentFile(projectId);
  const latest = await latestSnapshot(projectId);
  if (!(await pathExists(currentPath)) || !latest) {
    return { needs_resolution: false, snapshot_path: latest };
  }
  const current = validateTranscript(await readJson<WorkspaceTranscript>(currentPath));
  const snapshot = validateTranscript(await readJson<WorkspaceTranscript>(latest));
  return {
    needs_resolution: transcriptsDiffer(current, snapshot),
    snapshot_path: latest,
    snapshot,
  };
}

function parseTimecode(value: string): number {
  const parts = value.trim().split(":");
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error(`Invalid timecode: ${value}`);
  }
  if (parts.length === 2) return numbers[0] * 60 + numbers[1];
  if (parts.length === 3) return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
  throw new Error(`Invalid timecode: ${value}`);
}

function sameTime(left: number, right: number): boolean {
  return timestampMilliseconds(left) === timestampMilliseconds(right);
}

function timestampMilliseconds(seconds: number): number {
  return Math.round(Number(seconds) * 1000);
}

function timestampKey(start: number, end: number): string {
  return `${timestampMilliseconds(start)}:${timestampMilliseconds(end)}`;
}

type MarkdownSection = { start: number; end: number; text: string; headingLine: number };

function parseTimestampedMarkdown(content: string): { metadata: Record<string, string>; sections: MarkdownSection[] } {
  const metadata: Record<string, string> = {};
  const sections: MarkdownSection[] = [];
  let current: { start: number; end: number; lines: string[]; headingLine: number } | null = null;
  const heading = /^##\s+(.+?)\s+-->\s+(.+?)\s*$/;
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trimEnd();
    const match = line.match(heading);
    if (match) {
      if (current) sections.push({ start: current.start, end: current.end, text: current.lines.join("\n").trim(), headingLine: current.headingLine });
      try {
        current = { start: parseTimecode(match[1]), end: parseTimecode(match[2]), lines: [], headingLine: index + 1 };
      } catch {
        throw new Error(`Timestamp invalide à la ligne ${index + 1}: ${line}`);
      }
      continue;
    }
    if (!current) {
      if (line.includes(":") && !line.startsWith("#")) {
        const [key, ...rest] = line.split(":");
        metadata[key.trim()] = rest.join(":").trim();
      }
      continue;
    }
    current.lines.push(line);
  }
  if (current) sections.push({ start: current.start, end: current.end, text: current.lines.join("\n").trim(), headingLine: current.headingLine });
  return { metadata, sections };
}

function timestampRange(start: number, end: number): string {
  return `${formatPromptTime(start)} --> ${formatPromptTime(end)}`;
}

function alignmentError(
  title: string,
  transcript: WorkspaceTranscript,
  mismatches: Array<{ index: number; received?: { start: number; end: number; text: string } }>,
): Error {
  const details = mismatches.slice(0, 8).map(({ index, received }) => {
    const expected = transcript.segments[index];
    const expectedLine = expected
      ? `attendu: ## ${timestampRange(expected.start, expected.end)}\n  arabe: ${expected.text.trim() || "(vide)"}`
      : "attendu: aucun bloc supplémentaire";
    const receivedLine = received
      ? `reçu: ## ${timestampRange(received.start, received.end)}\n  texte: ${received.text.trim() || "(vide)"}`
      : "reçu: bloc absent";
    return `Bloc ${index + 1}\n  ${expectedLine}\n  ${receivedLine}`;
  });
  const suffix = mismatches.length > 8 ? `\n… et ${mismatches.length - 8} autre(s) bloc(s).` : "";
  return new Error(`${title}. Chaque titre doit reprendre exactement le timestamp de la transcription.\n${details.join("\n\n")}${suffix}`);
}

function segmentCountError(label: string, transcript: WorkspaceTranscript, sections: MarkdownSection[]): Error {
  const index = Math.min(sections.length, transcript.segments.length - 1);
  const expected = transcript.segments[index];
  const received = sections[index];
  const expectedLine = expected
    ? `attendu autour du bloc ${index + 1}: ## ${timestampRange(expected.start, expected.end)}\n  arabe: ${expected.text.trim() || "(vide)"}`
    : "attendu: aucun bloc supplémentaire";
  const receivedLine = received
    ? `reçu autour du bloc ${index + 1}: ## ${timestampRange(received.start, received.end)}\n  texte: ${received.text.trim() || "(vide)"}`
    : "reçu: bloc absent";
  return new Error(`${label} contient ${sections.length} bloc(s); attendu: ${transcript.segments.length}.\n${expectedLine}\n${receivedLine}`);
}

function translationFromJson(
  projectId: string,
  transcript: WorkspaceTranscript,
  payload: unknown,
  filename: string,
): WorkspaceTranslation {
  if (!payload || typeof payload !== "object") {
    throw new Error("La traduction JSON doit être un objet");
  }
  const source = payload as { language?: unknown; format?: unknown; segments?: unknown };
  if (!Array.isArray(source.segments)) {
    throw new Error("La traduction JSON doit contenir un tableau segments");
  }
  const translation: WorkspaceTranslation = {
    corpus_id: projectId,
    language: typeof source.language === "string" && source.language.trim() ? source.language.trim() : "fr",
    format: typeof source.format === "string" && source.format.trim() ? source.format.trim() : "tarjama-translation-v1",
    source_transcript_fingerprint: transcriptAlignmentFingerprint(transcript),
    imported_from: filename,
    segments: source.segments.map((segment, index) => {
      if (!segment || typeof segment !== "object") {
        throw new Error(`Segment ${index + 1} invalide dans la traduction JSON`);
      }
      const candidate = segment as { id?: unknown; start?: unknown; end?: unknown; translation?: unknown; text?: unknown };
      const translationText =
        typeof candidate.translation === "string"
          ? candidate.translation
          : typeof candidate.text === "string"
            ? candidate.text
            : "";
      return {
        id: String(candidate.id ?? ""),
        start: Number(candidate.start),
        end: Number(candidate.end),
        translation: translationText,
      };
    }),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  assertTranslationAlignment(transcript, translation);
  return translation;
}

function translationFromMarkdown(
  projectId: string,
  transcript: WorkspaceTranscript,
  content: string,
  filename: string,
): WorkspaceTranslation {
  const { metadata, sections } = parseTimestampedMarkdown(content);
  if (sections.length !== transcript.segments.length) {
    throw segmentCountError("La traduction", transcript, sections);
  }
  const mismatches: Array<{ index: number; received?: { start: number; end: number; text: string } }> = [];
  const segments = transcript.segments.map((source, index) => {
    const translated = sections[index];
    if (!sameTime(source.start, translated.start) || !sameTime(source.end, translated.end)) {
      mismatches.push({ index, received: translated });
    }
    return {
      id: String(source.id),
      start: source.start,
      end: source.end,
      translation: translated.text,
    };
  });
  if (mismatches.length) {
    throw alignmentError("Timestamps non alignés", transcript, mismatches);
  }
  return {
    corpus_id: projectId,
    language: metadata.language || "fr",
    format: metadata.format || "tarjama-translation-v1",
    source_transcript_fingerprint: transcriptAlignmentFingerprint(transcript),
    imported_from: filename,
    segments,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

function translationFromImportContent(
  projectId: string,
  transcript: WorkspaceTranscript,
  content: string,
  filename: string,
): WorkspaceTranslation {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("La traduction est vide");
  if (trimmed.startsWith("{")) {
    try {
      return translationFromJson(projectId, transcript, JSON.parse(trimmed), filename);
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`JSON de traduction invalide: ${err.message}`);
      }
      throw err;
    }
  }
  return translationFromMarkdown(projectId, transcript, content, filename);
}

function assertTranslationAlignment(transcript: WorkspaceTranscript, translation: WorkspaceTranslation): void {
  if (translation.segments.length !== transcript.segments.length) {
    const sections = translation.segments.map((segment, index) => ({
      start: segment.start,
      end: segment.end,
      text: segment.translation,
      headingLine: index + 1,
    }));
    throw segmentCountError("La traduction", transcript, sections);
  }
  const mismatches: Array<{ index: number; received?: { start: number; end: number; text: string } }> = [];
  transcript.segments.forEach((source, index) => {
    const translated = translation.segments[index];
    if (
      String(source.id) !== String(translated.id) ||
      !sameTime(source.start, translated.start) ||
      !sameTime(source.end, translated.end)
    ) {
      mismatches.push({
        index,
        received: { start: translated.start, end: translated.end, text: translated.translation },
      });
    }
  });
  if (mismatches.length) {
    throw alignmentError("Traduction non alignée", transcript, mismatches);
  }
}

class ToolError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly code: number | null,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function runTool(
  command: string,
  args: string[],
  cwd: string,
  onOutput?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Opération annulée"));
      return;
    }
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Opération annulée"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const rejectOnce = (error: ToolError) => {
      if (settled) return;
      settled = true;
      child.kill();
      cleanup();
      reject(error);
    };
    const appendOutput = (target: "stdout" | "stderr", chunk: unknown) => {
      const value = String(chunk);
      outputBytes += Buffer.byteLength(value, "utf8");
      if (outputBytes > MAX_TOOL_OUTPUT_BYTES) {
        rejectOnce(new ToolError(`${path.basename(command)} produced too much output`, stdout, stderr, null));
        return;
      }
      if (target === "stdout") stdout += value;
      else stderr += value;
      onOutput?.(value);
    };
    child.stdout.on("data", (chunk) => {
      appendOutput("stdout", chunk);
    });
    child.stderr.on("data", (chunk) => {
      appendOutput("stderr", chunk);
    });
    child.on("error", (error) => {
      rejectOnce(new ToolError(`${path.basename(command)} could not be started at ${command}\n${error.message}`, stdout, stderr, null));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) {
        resolve(stdout);
      } else {
        const output = (stderr || stdout).trim();
        reject(new ToolError(`${path.basename(command)} exited with code ${code}\n${output}`, stdout, stderr, code));
      }
    });
  });
}

function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

function executableExtension(): string {
  return process.platform === "win32" ? ".exe" : "";
}

async function makeExecutable(filePath: string): Promise<void> {
  if (process.platform !== "win32") {
    await fs.chmod(filePath, 0o755);
  }
}

function ytdlpAssetName(): string {
  if (process.platform === "darwin") return "yt-dlp_macos";
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "linux") return "yt-dlp";
  throw new Error(`Unsupported platform for yt-dlp update: ${process.platform}`);
}

function ytdlpDownloadUrl(assetName: string): string {
  return `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;
}

async function expectedYtdlpChecksum(assetName: string): Promise<string> {
  const response = await fetch(ytdlpDownloadUrl("SHA2-256SUMS"));
  if (!response.ok) throw new Error(`Checksum download failed: HTTP ${response.status}`);
  const line = (await response.text())
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().split(/\s+/).at(-1)?.replace(/^\*/, "") === assetName);
  const checksum = line?.trim().split(/\s+/)[0];
  if (!checksum || !/^[a-f0-9]{64}$/i.test(checksum)) {
    throw new Error(`Checksum missing for ${assetName}`);
  }
  return checksum.toLowerCase();
}

async function downloadFile(url: string, targetPath: string, expectedChecksum: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 100 * 1024 * 1024) {
    throw new Error("Downloaded tool is unexpectedly large");
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length > 100 * 1024 * 1024) throw new Error("Downloaded tool is unexpectedly large");
  const checksum = createHash("sha256").update(content).digest("hex");
  if (checksum !== expectedChecksum) {
    throw new Error("yt-dlp checksum verification failed; the existing version was preserved");
  }
  const tmpPath = `${targetPath}.tmp`;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(tmpPath, content, { mode: 0o755 });
  await makeExecutable(tmpPath);
  await fs.rm(targetPath, { force: true }).catch(() => undefined);
  await fs.rename(tmpPath, targetPath);
}

export async function updateYtdlp(): Promise<UpdateToolResult> {
  const assetName = ytdlpAssetName();
  const targetPath = path.join(app.getPath("userData"), "bin", platformKey(), `yt-dlp${executableExtension()}`);
  await downloadFile(ytdlpDownloadUrl(assetName), targetPath, await expectedYtdlpChecksum(assetName));
  const version = (await runTool(targetPath, ["--version"], app.getPath("userData"))).trim();
  return { path: targetPath, version };
}

const YTDLP_RETRY_ARGS = ["--extractor-retries", "5", "--retry-sleep", "extractor:1"];

function isRetryableYtdlpError(error: unknown): boolean {
  if (!(error instanceof ToolError)) return false;
  const output = `${error.stderr}\n${error.stdout}`;
  return /The page needs to be reloaded/i.test(output) || /Incomplete data received/i.test(output);
}

async function runYtdlp(
  command: string,
  args: string[],
  cwd: string,
  onOutput?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runTool(command, [...YTDLP_RETRY_ARGS, ...args], cwd, onOutput, signal);
    } catch (error) {
      lastError = error;
      if (!isRetryableYtdlpError(error) || attempt === 3) break;
      await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

type YtdlpFormat = {
  format_id?: string;
  ext?: string;
  acodec?: string;
  vcodec?: string;
  height?: number;
  fps?: number;
  filesize?: number;
  filesize_approx?: number;
  format_note?: string;
  resolution?: string;
  tbr?: number;
};

type YtdlpMetadata = {
  id?: string;
  title?: string;
  duration?: number;
  webpage_url?: string;
  formats?: YtdlpFormat[];
};

const BEST_MERGED_FORMAT = "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b[ext=mp4]/best";
const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

type ParsedYoutubeUrl = {
  inputUrl: string;
  canonicalUrl: string;
  youtubeId?: string;
  unverified: boolean;
  warning?: string;
};

function withDefaultProtocol(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:[/:?#]|$)/.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function firstYoutubeIdCandidate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim();
  if (YOUTUBE_ID_PATTERN.test(cleaned)) return cleaned;
  const match = cleaned.match(/[?&/]([a-zA-Z0-9_-]{11})(?=$|[?&#/])/);
  return match?.[1];
}

function isYoutubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return (
    host === "youtube.com" ||
    host === "youtu.be" ||
    host === "youtube-nocookie.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com"
  );
}

function youtubeIdFromUrl(url: URL, depth = 0): string | undefined {
  if (depth > 2) return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathParts = url.pathname.split("/").filter(Boolean);
  const fromVParam = firstYoutubeIdCandidate(url.searchParams.get("v"));
  if (fromVParam) return fromVParam;

  if (host === "youtu.be" && pathParts[0]) {
    return firstYoutubeIdCandidate(pathParts[0]);
  }
  if (["shorts", "embed", "live", "v", "e"].includes(pathParts[0] ?? "") && pathParts[1]) {
    return firstYoutubeIdCandidate(pathParts[1]);
  }
  if (pathParts[0] === "watch" && pathParts[1]) {
    return firstYoutubeIdCandidate(pathParts[1]);
  }

  const nested = url.searchParams.get("u") || url.searchParams.get("url") || url.searchParams.get("q");
  if (nested) {
    try {
      const nestedUrl = new URL(nested, "https://www.youtube.com");
      if (isYoutubeHost(nestedUrl.hostname)) return youtubeIdFromUrl(nestedUrl, depth + 1);
    } catch {
      return firstYoutubeIdCandidate(nested);
    }
  }
  return undefined;
}

function parseYoutubeUrl(rawUrl: string): ParsedYoutubeUrl {
  const inputUrl = rawUrl.trim();
  if (!inputUrl) throw new Error("Colle un lien YouTube avant de créer le projet.");
  if (inputUrl.length > 4096) throw new Error("Le lien vidéo est anormalement long");

  if (YOUTUBE_ID_PATTERN.test(inputUrl)) {
    return {
      inputUrl,
      canonicalUrl: `https://www.youtube.com/watch?v=${inputUrl}`,
      youtubeId: inputUrl,
      unverified: false,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(withDefaultProtocol(inputUrl));
  } catch {
    return {
      inputUrl,
      canonicalUrl: inputUrl,
      unverified: true,
      warning: "Lien non reconnu. Le projet est créé quand même, mais le lien peut être invalide et les doublons ne peuvent pas être détectés de façon fiable.",
    };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      inputUrl,
      canonicalUrl: inputUrl,
      unverified: true,
      warning: "Protocole non reconnu. Le projet est créé quand même, mais le téléchargement risque d'échouer.",
    };
  }

  if (!isYoutubeHost(parsed.hostname)) {
    return {
      inputUrl,
      canonicalUrl: parsed.toString(),
      unverified: true,
      warning: "Ce lien ne semble pas être un lien YouTube. Le projet est créé quand même, avec risque de doublon ou d'échec au téléchargement.",
    };
  }

  const youtubeId = youtubeIdFromUrl(parsed);
  if (youtubeId) {
    return {
      inputUrl,
      canonicalUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
      youtubeId,
      unverified: false,
    };
  }

  return {
    inputUrl,
    canonicalUrl: parsed.toString(),
    unverified: true,
    warning: "Format YouTube inhabituel. Le projet est créé quand même, mais Tarjama Studio ne peut pas garantir la détection des doublons avant téléchargement.",
  };
}

function comparableUrl(value: string): string {
  try {
    const url = new URL(withDefaultProtocol(value));
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function parseYtdlpMetadata(output: string): YtdlpMetadata {
  const trimmed = output.trim();
  try {
    const metadata = JSON.parse(trimmed) as YtdlpMetadata;
    return {
      id: metadata.id,
      title: metadata.title,
      duration: Number.isFinite(Number(metadata.duration)) ? Number(metadata.duration) : undefined,
      webpage_url: metadata.webpage_url,
      formats: Array.isArray(metadata.formats) ? metadata.formats : [],
    };
  } catch (error) {
    throw new Error("yt-dlp did not return valid JSON metadata", { cause: error });
  }
}

function assertYoutubeMetadata(metadata: { id?: string; title?: string; duration?: number; webpage_url?: string }): void {
  if (!metadata.id || typeof metadata.id !== "string") {
    throw new Error("yt-dlp metadata is missing the YouTube id");
  }
  if (!metadata.title || typeof metadata.title !== "string") {
    throw new Error("yt-dlp metadata is missing the video title");
  }
  if (metadata.duration !== undefined && typeof metadata.duration !== "number") {
    throw new Error("yt-dlp metadata duration is invalid");
  }
  if (metadata.webpage_url !== undefined) {
    try {
      const url = new URL(metadata.webpage_url);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("invalid protocol");
      }
    } catch {
      throw new Error("yt-dlp metadata webpage_url is invalid");
    }
  }
}

function formatBytes(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return "";
  const units = ["o", "Ko", "Mo", "Go"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function youtubeFormatLabel(format: YtdlpFormat): string {
  const quality = format.height ? `${format.height}p` : format.resolution || "qualité inconnue";
  const fps = format.fps ? `${format.fps}fps` : "";
  const ext = format.ext ? format.ext.toUpperCase() : "";
  const size = formatBytes(format.filesize ?? format.filesize_approx);
  const note = format.format_note && format.format_note !== quality ? format.format_note : "";
  return [quality, fps, ext, size, note].filter(Boolean).join(" · ");
}

function formatSize(format: YtdlpFormat): number {
  return Number(format.filesize ?? format.filesize_approx) || 0;
}

function formatQualityRank(format: YtdlpFormat): number[] {
  return [
    Number(format.height) || 0,
    Number(format.fps) || 0,
    Number(format.tbr) || 0,
    formatSize(format),
  ];
}

function compareFormatQuality(left: YtdlpFormat, right: YtdlpFormat): number {
  const leftRank = formatQualityRank(left);
  const rightRank = formatQualityRank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    const delta = rightRank[index] - leftRank[index];
    if (delta !== 0) return delta;
  }
  return 0;
}

function bestByQuality(formats: YtdlpFormat[]): YtdlpFormat | undefined {
  return [...formats].sort(compareFormatQuality)[0];
}

function bestMergedLabel(metadata: YtdlpMetadata): string {
  const formats = metadata.formats ?? [];
  const videoFormats = formats.filter((format) => format.vcodec && format.vcodec !== "none");
  const separateVideoFormats = videoFormats.filter((format) => !format.acodec || format.acodec === "none");
  const audioFormats = formats.filter((format) => format.acodec && format.acodec !== "none");
  const separateAudioFormats = audioFormats.filter((format) => !format.vcodec || format.vcodec === "none");
  const bestVideo =
    bestByQuality(separateVideoFormats.filter((format) => format.ext === "mp4")) ??
    bestByQuality(separateVideoFormats) ??
    bestByQuality(videoFormats.filter((format) => format.ext === "mp4")) ??
    bestByQuality(videoFormats);
  const bestAudio =
    bestByQuality(separateAudioFormats.filter((format) => format.ext === "m4a")) ?? bestByQuality(separateAudioFormats);
  if (!bestVideo) return "Meilleure qualité fusionnée (vidéo + audio, recommandé)";

  const quality = bestVideo.height ? `${bestVideo.height}p` : bestVideo.resolution || "qualité inconnue";
  const fps = bestVideo.fps ? `${bestVideo.fps}fps` : "";
  const videoExt = bestVideo.ext ? bestVideo.ext.toUpperCase() : "vidéo";
  const alreadyHasAudio = Boolean(bestVideo.acodec && bestVideo.acodec !== "none");
  const audioExt = bestAudio?.ext ? bestAudio.ext.toUpperCase() : "audio";
  const container = alreadyHasAudio || !bestAudio ? videoExt : `${videoExt} + ${audioExt}`;
  const totalSize = formatSize(bestVideo) + (alreadyHasAudio ? 0 : formatSize(bestAudio ?? {}));
  const size = totalSize > 0 ? `~${formatBytes(totalSize)}` : "";
  return ["Meilleure qualité fusionnée", quality, fps, container, size].filter(Boolean).join(" · ");
}

function youtubeFormatOptions(metadata: YtdlpMetadata): YoutubeFormatOption[] {
  const progressive = (metadata.formats ?? [])
    .filter((format) => format.format_id && format.vcodec && format.vcodec !== "none" && format.acodec && format.acodec !== "none")
    .map((format) => ({
      id: String(format.format_id),
      label: youtubeFormatLabel(format),
      formatSelector: String(format.format_id),
      height: Number.isFinite(Number(format.height)) ? Number(format.height) : undefined,
      fps: Number.isFinite(Number(format.fps)) ? Number(format.fps) : undefined,
      ext: format.ext,
      filesizeApprox: Number(format.filesize ?? format.filesize_approx) || undefined,
      note: format.format_note,
    }))
    .sort((left, right) => (right.height ?? 0) - (left.height ?? 0) || (right.fps ?? 0) - (left.fps ?? 0));
  return [
    {
      id: "best_merged",
      label: bestMergedLabel(metadata),
      formatSelector: BEST_MERGED_FORMAT,
      note: "Fusionne le meilleur flux vidéo et le meilleur flux audio disponibles",
    },
    ...progressive,
  ];
}

function lastOutputLine(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    throw new Error("Command did not print an output path");
  }
  return lines[lines.length - 1];
}

function isHttp403YtdlpError(error: unknown): boolean {
  if (!(error instanceof ToolError)) return false;
  const output = `${error.stderr}\n${error.stdout}`;
  return /HTTP Error 403|403:\s*Forbidden/i.test(output);
}

function parseProgressPercent(value: string): number | undefined {
  const match = value.match(/([0-9]+(?:\.[0-9]+)?)%/);
  if (!match) return undefined;
  const percent = Number(match[1]);
  if (!Number.isFinite(percent)) return undefined;
  return Math.max(0, Math.min(100, percent));
}

function handleYtdlpProgressChunk(
  chunk: string,
  projectId: string,
  emit?: (progress: DownloadProgress) => void,
): void {
  if (!emit) return;
  for (const rawLine of chunk.split(/\r|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("download:") || /^[0-9]+(?:\.[0-9]+)?%\|/.test(line)) {
      const fields = line.startsWith("download:") ? line.split("|").slice(1) : line.split("|");
      const [percentValue = "", speedValue = "", etaValue = ""] = fields;
      const percent = parseProgressPercent(percentValue);
      emit({
        projectId,
        stage: "download",
        percent,
        speed: speedValue.trim() || undefined,
        eta: etaValue.trim() || undefined,
        message: [
          percent !== undefined ? `${percent.toFixed(1)}%` : "Téléchargement en cours",
          speedValue.trim(),
          etaValue.trim() ? `ETA ${etaValue.trim()}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
      continue;
    }
    if (line.includes("[Merger]") || line.includes("[Fixup") || line.includes("[VideoRemuxer]")) {
      emit({ projectId, stage: "mux", message: "Assemblage de la vidéo et de l'audio..." });
    }
  }
}

function formatEtaSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const secs = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function parseFfmpegOutTime(line: string): number | null {
  const trimmed = line.trim();
  const milliseconds = trimmed.match(/^out_time_ms=(-?\d+)$/);
  if (milliseconds) {
    const value = Number(milliseconds[1]);
    if (Number.isFinite(value) && value >= 0) return value / 1_000_000;
  }
  const timestamp = trimmed.match(/^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (timestamp) {
    const [, hours, minutes, seconds] = timestamp;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  }
  return null;
}

function createFfmpegExportProgressHandler(
  projectId: string,
  track: ExportSubtitleTrack,
  durationSeconds: number,
  emit?: (progress: ExportProgress) => void,
): (chunk: string) => void {
  let buffer = "";
  const startedAt = Date.now();
  return (chunk: string) => {
    if (!emit) return;
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const outTime = parseFfmpegOutTime(line);
      if (outTime !== null && durationSeconds > 0) {
        const percent = Math.max(0, Math.min(99.9, (outTime / durationSeconds) * 100));
        const elapsed = (Date.now() - startedAt) / 1000;
        const remaining = percent > 0 ? (elapsed * (100 - percent)) / percent : 0;
        emit({
          projectId,
          track,
          stage: "render",
          percent,
          eta: percent > 0 ? formatEtaSeconds(remaining) : undefined,
          message: `Export ${track === "arabic" ? "arabe" : "traduction"} en cours`,
        });
        continue;
      }
      if (line.trim() === "progress=end") {
        emit({
          projectId,
          track,
          stage: "done",
          percent: 100,
          eta: "00:00",
          message: "Export terminé",
        });
      }
    }
  };
}

type MediaStreams = {
  audio: boolean;
  video: boolean;
  duration?: number;
  width?: number;
  height?: number;
};

async function mediaStreams(filePath: string, ffmpeg: string): Promise<MediaStreams> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-i", filePath], { windowsHide: true });
    let combined = "";
    child.stdout.on("data", (chunk) => {
      combined += String(chunk);
      if (Buffer.byteLength(combined, "utf8") > MAX_TOOL_OUTPUT_BYTES) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      combined += String(chunk);
      if (Buffer.byteLength(combined, "utf8") > MAX_TOOL_OUTPUT_BYTES) child.kill();
    });
    child.on("error", reject);
    child.on("close", () => resolve(combined));
  });
  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : undefined;
  const videoLine = output.split(/\r?\n/).find((line) => line.includes(" Video:"));
  const dimensionsMatch = videoLine?.match(/\b(\d{2,5})x(\d{2,5})(?:\s|,|\[)/);
  let width = dimensionsMatch ? Number(dimensionsMatch[1]) : undefined;
  let height = dimensionsMatch ? Number(dimensionsMatch[2]) : undefined;
  const rotationMatch = output.match(/rotation of\s+(-?\d+(?:\.\d+)?)\s+degrees/i)
    ?? output.match(/rotate\s*:\s*(-?\d+(?:\.\d+)?)/i);
  if (width && height && rotationMatch && Math.abs(Math.round(Number(rotationMatch[1]) / 90)) % 2 === 1) {
    [width, height] = [height, width];
  }
  return { audio: output.includes(" Audio:"), video: output.includes(" Video:"), duration, width, height };
}

export async function resolveTool(name: "yt-dlp" | "ffmpeg"): Promise<string> {
  const extension = executableExtension();
  const key = platformKey();
  const candidates = [
    ...(name === "yt-dlp" ? [path.join(app.getPath("userData"), "bin", key, `${name}${extension}`)] : []),
    path.join(process.resourcesPath, "desktop-bin", key, `${name}${extension}`),
    ...(!app.isPackaged
      ? [
          path.join(app.getAppPath(), "desktop-bin", key, `${name}${extension}`),
          path.join(app.getAppPath(), "..", "desktop-bin", key, `${name}${extension}`),
          path.join(process.cwd(), "desktop-bin", key, `${name}${extension}`),
        ]
      : []),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error(`Missing bundled ${name}. Run make desktop-tools, then restart the app.`);
}

async function resolveDesktopResource(relativePath: string): Promise<string | null> {
  const candidates = [
    path.join(process.resourcesPath, relativePath),
    ...(!app.isPackaged
      ? [
          path.join(MODULE_DIR, relativePath),
          path.join(MODULE_DIR, "..", relativePath),
          path.join(MODULE_DIR, "..", "..", relativePath),
          path.join(app.getAppPath(), relativePath),
          path.join(app.getAppPath(), "..", relativePath),
          path.join(process.cwd(), relativePath),
        ]
      : []),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function resolveBundledDesktopResource(relativePath: string): Promise<string | null> {
  const candidates = [
    path.join(process.resourcesPath, relativePath),
    ...(!app.isPackaged
      ? [
          path.join(MODULE_DIR, relativePath),
          path.join(MODULE_DIR, "..", relativePath),
          path.join(MODULE_DIR, "..", "..", relativePath),
          path.join(app.getAppPath(), relativePath),
          path.join(app.getAppPath(), "..", relativePath),
          path.join(process.cwd(), relativePath),
        ]
      : []),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function readLibrary(): Promise<DesktopLibraryInfo> {
  const root = libraryDir();
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });
  const projects: DesktopProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      assertSafeProjectId(entry.name);
    } catch {
      continue;
    }
    const filePath = path.join(root, entry.name, PROJECT_FILE);
    if (!(await pathExists(filePath))) continue;
    const project = await readJson<DesktopProject>(filePath);
    if (project.id !== entry.name) continue;
    projects.push(await refreshProjectArtifactPaths(project));
  }
  projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { libraryDir: root, projects };
}

async function readProject(projectId: string): Promise<DesktopProject> {
  const filePath = projectFile(projectId);
  if (!(await pathExists(filePath))) throw new Error("Project not found");
  const project = await readJson<DesktopProject>(filePath);
  if (project.id !== projectId) throw new Error("Le projet ne correspond pas à son dossier");
  return await refreshProjectArtifactPaths(project);
}

async function findProjectByYoutubeId(youtubeId: string): Promise<DesktopProject | null> {
  const library = await readLibrary();
  return library.projects.find((project) => project.youtubeId === youtubeId) ?? null;
}

async function findProjectByYoutubeUrl(url: string): Promise<DesktopProject | null> {
  const target = comparableUrl(url);
  const library = await readLibrary();
  return library.projects.find((project) => project.youtubeUrl && comparableUrl(project.youtubeUrl) === target) ?? null;
}

function duplicateProjectError(project: DesktopProject): Error {
  const archiveHint = project.archivedAt ? " Il est actuellement archivé." : "";
  return new Error(`Cette vidéo existe déjà dans la bibliothèque: ${project.title}.${archiveHint}`);
}

export async function createYoutubeProject(
  request: CreateYoutubeProjectRequest,
): Promise<CreateYoutubeProjectResult> {
  await fs.mkdir(libraryDir(), { recursive: true });
  const parsed = parseYoutubeUrl(request.url);
  if (parsed.youtubeId) {
    const existing = await findProjectByYoutubeId(parsed.youtubeId);
    if (existing) throw duplicateProjectError(existing);
  } else {
    const existing = await findProjectByYoutubeUrl(parsed.canonicalUrl);
    if (existing) throw duplicateProjectError(existing);
  }

  const idSeed = parsed.youtubeId ? `youtube_${parsed.youtubeId}` : `youtube_link_${shortHash(parsed.canonicalUrl)}`;
  let id = slugify(idSeed);
  if (await pathExists(projectDir(id))) {
    id = slugify(`${idSeed}_${Date.now()}`);
  }

  const title =
    request.title?.trim() ||
    (parsed.youtubeId ? `YouTube ${parsed.youtubeId}` : `Lien YouTube ${shortHash(parsed.canonicalUrl).slice(0, 6)}`);
  if (title.length > 200) throw new Error("Le titre du projet ne peut pas dépasser 200 caractères");
  const project: DesktopProject = {
    id,
    title,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    youtubeUrl: parsed.canonicalUrl,
    youtubeId: parsed.youtubeId,
    youtubeUrlUnverified: parsed.unverified || undefined,
    youtubeUrlWarning: parsed.warning,
  };
  await writeProject(project);
  return { project, warning: parsed.warning };
}

export async function createLocalProject(title: string): Promise<CreateLocalProjectResult> {
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  if (!cleanTitle) throw new Error("Le titre du projet ne peut pas être vide");
  if (cleanTitle.length > 200) throw new Error("Le titre du projet ne peut pas dépasser 200 caractères");
  await fs.mkdir(libraryDir(), { recursive: true });
  let id = slugify(`local_${cleanTitle}`);
  if (await pathExists(projectDir(id))) id = slugify(`local_${cleanTitle}_${Date.now()}`);
  const project: DesktopProject = {
    id,
    title: cleanTitle,
    titleCustomizedAt: nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await writeProject(project);
  return { project };
}

export async function pickTextImport(kind: "transcript" | "cleanup" | "translation"): Promise<{ filename: string; content: string } | null> {
  if (!["transcript", "cleanup", "translation"].includes(kind)) throw new Error("Type d’import invalide");
  const filters = kind === "transcript"
    ? [{ name: "Transcript JSON", extensions: ["json"] }]
    : [{ name: "Document horodaté", extensions: ["md", "txt", "json"] }];
  const selection = await dialog.showOpenDialog({
    title: kind === "translation"
      ? "Choisir une traduction"
      : kind === "cleanup"
        ? "Choisir une transcription nettoyée"
        : "Choisir une transcription",
    properties: ["openFile"],
    filters,
  });
  if (selection.canceled || !selection.filePaths[0]) return null;
  return {
    filename: path.basename(selection.filePaths[0]),
    content: await readTextFileLimited(selection.filePaths[0]),
  };
}

export async function importTranscriptContent(
  projectId: string,
  content: string,
  _filename = "transcript.json",
): Promise<ImportTranscriptResult> {
  const projectPath = projectFile(projectId);
  if (!(await pathExists(projectPath))) {
    throw new Error("Project not found");
  }
  const project = await readJson<DesktopProject>(projectPath);
  await requireProjectVideo(project);
  assertTextSize(content);
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch (error) {
    throw new Error(`JSON de transcription invalide: ${error instanceof Error ? error.message : String(error)}`);
  }
  const transcript = validateTranscript(payload);
  const dir = projectDir(project.id);
  await fs.mkdir(dir, { recursive: true });

  const transcriptPath = transcriptFile(project.id);
  transcript.corpus_id = project.id;
  transcript.created_at = transcript.created_at || nowIso();
  transcript.updated_at = nowIso();
  await writeJson(transcriptPath, transcript);
  await writeJson(currentFile(project.id), transcript);
  await ensureInitialSnapshot(project.id, transcript);

  const updatedProject: DesktopProject = {
    ...project,
    updatedAt: nowIso(),
    transcriptPath,
  };
  await writeProject(updatedProject);
  return { project: updatedProject, transcriptPath, segmentCount: transcript.segments.length };
}

export async function importTranscript(projectId: string): Promise<ImportTranscriptResult | null> {
  const selection = await pickTextImport("transcript");
  if (!selection) return null;
  return await importTranscriptContent(projectId, selection.content, selection.filename);
}

const PROMPT_FILENAMES: Record<PromptKind, string> = {
  transcript_cleanup: "transcript_cleanup.md",
  translation: "translation.md",
};

function assertPromptKind(kind: unknown): asserts kind is PromptKind {
  if (kind !== "transcript_cleanup" && kind !== "translation") {
    throw new Error("Type de prompt invalide");
  }
}

function promptOverridePath(kind: PromptKind): string {
  assertPromptKind(kind);
  return path.join(app.getPath("userData"), "prompts", PROMPT_FILENAMES[kind]);
}

async function defaultPrompt(kind: PromptKind): Promise<string> {
  const bundled = await resolveBundledDesktopResource(path.join("prompts", PROMPT_FILENAMES[kind]));
  if (!bundled) throw new Error(`Le prompt par défaut ${kind} est introuvable`);
  return await fs.readFile(bundled, "utf8");
}

async function promptValue(kind: PromptKind): Promise<{ content: string; customized: boolean }> {
  const fallback = await defaultPrompt(kind);
  const override = promptOverridePath(kind);
  if (!(await pathExists(override))) return { content: fallback, customized: false };
  const content = await fs.readFile(override, "utf8");
  if (content === fallback) {
    await fs.rm(override, { force: true });
    return { content: fallback, customized: false };
  }
  return { content, customized: true };
}

function validatePromptTemplate(kind: PromptKind, content: string): void {
  assertPromptKind(kind);
  assertTextSize(content, MAX_PROMPT_BYTES);
  if (!content.trim()) throw new Error("Le prompt ne peut pas être vide");
  const required = kind === "transcript_cleanup"
    ? ["{{corpus_id}}", "{{title}}", "{{source_blocks}}"]
    : ["{{corpus_id}}", "{{source_blocks}}", "{{project_instructions_block}}"];
  const missing = required.filter((placeholder) => !content.includes(placeholder));
  if (missing.length) throw new Error(`Placeholder(s) obligatoire(s) manquant(s): ${missing.join(", ")}`);
}

export async function readPromptSettings(): Promise<DesktopPromptSettings> {
  const cleanup = await promptValue("transcript_cleanup");
  const translation = await promptValue("translation");
  return {
    transcriptCleanup: cleanup.content,
    translation: translation.content,
    transcriptCleanupCustomized: cleanup.customized,
    translationCustomized: translation.customized,
  };
}

export async function savePromptOverride(kind: PromptKind, content: string): Promise<DesktopPromptSettings> {
  validatePromptTemplate(kind, content);
  const target = promptOverridePath(kind);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return await readPromptSettings();
}

export async function resetPromptOverride(kind: PromptKind): Promise<DesktopPromptSettings> {
  await fs.rm(promptOverridePath(kind), { force: true });
  return await readPromptSettings();
}

export async function renderCleanupPrompt(
  projectId: string,
  transcript: WorkspaceTranscript,
): Promise<string> {
  const project = await readProject(projectId);
  await requireProjectVideo(project);
  const clean = transcriptWithoutSegmentTranslations(validateTranscript(transcript));
  const sourceBlocks = clean.segments
    .map((segment) => `## ${formatPromptTime(segment.start)} --> ${formatPromptTime(segment.end)}\n${segment.text.trim()}`)
    .join("\n\n");
  const template = (await promptValue("transcript_cleanup")).content;
  validatePromptTemplate("transcript_cleanup", template);
  return template
    .replaceAll("{{corpus_id}}", projectId)
    .replaceAll("{{title}}", project.title)
    .replace("{{source_blocks}}", sourceBlocks);
}

function formatPromptTime(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${base}.${String(millis).padStart(3, "0")}`;
}

export async function renderTranslationPrompt(
  projectId: string,
  transcript: WorkspaceTranscript,
): Promise<string> {
  const clean = validateTranscript(transcript);
  const sourceBlocks = clean.segments
    .map((segment) => `## ${formatPromptTime(segment.start)} --> ${formatPromptTime(segment.end)}\n${segment.text.trim()}`)
    .join("\n\n");
  const instructions = clean.project_instructions?.trim();
  const instructionsBlock = instructions ? `\nInstructions propres à ce projet:\n${instructions}\n` : "";
  return (await promptValue("translation")).content
    .replaceAll("{{corpus_id}}", projectId)
    .replace("{{project_instructions_block}}", instructionsBlock)
    .replace("{{source_blocks}}", sourceBlocks);
}

async function saveCleanedTranscript(
  projectId: string,
  current: WorkspaceTranscript,
  transcript: WorkspaceTranscript,
  summary: Omit<CleanedTranscriptImportResult, "loaded">,
): Promise<CleanedTranscriptImportResult> {
  const project = await readProject(projectId);
  const clean = transcriptWithoutSegmentTranslations(transcript);
  clean.corpus_id = projectId;
  clean.updated_at = nowIso();
  await writeSnapshot(projectId, current, "pre_cleanup");

  let translationPath = project.translationPath;
  const existingTranslationPath = translationFile(projectId);
  if (await pathExists(existingTranslationPath)) {
    const translation = await readJson<WorkspaceTranslation>(existingTranslationPath);
    try {
      assertTranslationAlignment(clean, translation);
    } catch {
      await writeTranslationSnapshot(projectId, translation, "pre_cleanup");
      await fs.rm(existingTranslationPath, { force: true });
      translationPath = undefined;
    }
  }

  await writeJson(transcriptFile(projectId), clean);
  await writeJson(currentFile(projectId), clean);
  await writeSnapshot(projectId, clean, "cleaned");
  await writeProject({
    ...project,
    updatedAt: nowIso(),
    transcriptPath: transcriptFile(projectId),
    translationPath,
  });
  return { loaded: await loadProject(projectId), ...summary };
}

async function importCleanedTranscriptPayload(
  projectId: string,
  payload: unknown,
): Promise<CleanedTranscriptImportResult> {
  const project = await readProject(projectId);
  await requireProjectVideo(project);
  const current = await loadSavedTranscript(projectId);
  if (!current) throw new Error("Aucune transcription à nettoyer dans ce projet");
  const { transcript, summary } = validateCleanedTranscript(current, payload);
  return await saveCleanedTranscript(projectId, current, transcript, summary);
}

export async function importCleanedTranscriptContent(
  projectId: string,
  content: string,
): Promise<CleanedTranscriptImportResult> {
  assertTextSize(content);
  if (!content.trim()) throw new Error("La transcription nettoyée est vide");
  const project = await readProject(projectId);
  await requireProjectVideo(project);
  const current = await loadSavedTranscript(projectId);
  if (!current) throw new Error("Aucune transcription à nettoyer dans ce projet");
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      return await importCleanedTranscriptPayload(projectId, JSON.parse(trimmed));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`JSON de transcription invalide: ${error.message}`);
      throw error;
    }
  }
  const { transcript, summary } = cleanedTranscriptFromMarkdown(projectId, current, content);
  return await saveCleanedTranscript(projectId, current, transcript, summary);
}

export async function importCleanedTranscriptFile(
  projectId: string,
): Promise<CleanedTranscriptImportResult | null> {
  const project = await readProject(projectId);
  await requireProjectVideo(project);
  const selection = await dialog.showOpenDialog({
    title: `Importer la transcription nettoyée pour ${project.title}`,
    properties: ["openFile"],
    filters: [
      { name: "Transcription Markdown", extensions: ["md", "markdown", "txt"] },
      { name: "Transcription JSON (ancien format)", extensions: ["json"] },
      { name: "Tous les fichiers", extensions: ["*"] },
    ],
  });
  if (selection.canceled || !selection.filePaths[0]) return null;
  return await importCleanedTranscriptContent(projectId, await readTextFileLimited(selection.filePaths[0]));
}

async function copyVideoIntoProject(
  project: DesktopProject,
  sourcePath: string,
  fallbackTitle?: string,
): Promise<DownloadYoutubeResult> {
  const ffmpeg = await resolveTool("ffmpeg");
  const streams = await mediaStreams(sourcePath, ffmpeg);
  if (!streams.video || !streams.audio) {
    throw new Error("La vidéo importée doit contenir une piste vidéo et une piste audio");
  }

  const extension = path.extname(sourcePath) || ".mp4";
  const dir = projectDir(project.id);
  await fs.mkdir(dir, { recursive: true });
  await removeGeneratedSourceFiles(dir);
  const videoPath = path.join(dir, `source${extension}`);
  await fs.copyFile(sourcePath, videoPath);
  await assertInsideLibrary(videoPath);

  const updatedProject: DesktopProject = {
    ...project,
    title: project.title || fallbackTitle || path.basename(sourcePath, extension),
    updatedAt: nowIso(),
    videoPath,
    durationSeconds: streams.duration,
  };
  await writeProject(updatedProject);
  return { project: updatedProject, videoPath };
}

export async function importLocalVideo(projectId?: string, title?: string): Promise<DownloadYoutubeResult | null> {
  await fs.mkdir(libraryDir(), { recursive: true });
  const selection = await dialog.showOpenDialog({
    title: "Importer une vidéo",
    properties: ["openFile"],
    filters: [
      { name: "Vidéos", extensions: ["mp4", "mov", "mkv", "webm", "m4v"] },
      { name: "Tous les fichiers", extensions: ["*"] },
    ],
  });
  if (selection.canceled || !selection.filePaths[0]) return null;

  const sourcePath = selection.filePaths[0];
  if (projectId) {
    return await copyVideoIntoProject(await readProject(projectId), sourcePath, path.basename(sourcePath, path.extname(sourcePath)));
  }

  const extension = path.extname(sourcePath) || ".mp4";
  const fallbackTitle = path.basename(sourcePath, extension);
  const projectTitle = title?.replace(/\s+/g, " ").trim() || fallbackTitle;
  let id = slugify(`local_${projectTitle}`);
  if (await pathExists(projectDir(id))) {
    id = slugify(`local_${projectTitle}_${Date.now()}`);
  }
  const project: DesktopProject = {
    id,
    title: projectTitle,
    titleCustomizedAt: title?.trim() ? nowIso() : undefined,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return await copyVideoIntoProject(project, sourcePath, projectTitle);
}

export async function listYoutubeFormats(url: string): Promise<YoutubeFormatsResult> {
  await fs.mkdir(libraryDir(), { recursive: true });
  const ytdlp = await resolveTool("yt-dlp");
  const ffmpeg = await resolveTool("ffmpeg");
  const sourceUrl = safeRemoteUrl(url);
  const metadataText = await runYtdlp(
    ytdlp,
    [
      "--no-playlist",
      "--ffmpeg-location",
      ffmpeg,
      "-J",
      "--",
      sourceUrl,
    ],
    libraryDir(),
  );
  const metadata = parseYtdlpMetadata(metadataText);
  assertYoutubeMetadata(metadata);
  return {
    title: metadata.title ?? "",
    duration: metadata.duration,
    webpageUrl: metadata.webpage_url,
    formats: youtubeFormatOptions(metadata),
  };
}

export async function downloadYoutube(
  request: DownloadYoutubeRequest,
  emitProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadYoutubeResult> {
  await fs.mkdir(libraryDir(), { recursive: true });
  const ytdlp = await resolveTool("yt-dlp");
  const ffmpeg = await resolveTool("ffmpeg");
  const existingTarget = request.projectId ? await readProject(request.projectId) : null;
  const sourceUrl = safeRemoteUrl(request.url.trim() || existingTarget?.youtubeUrl || "");
  emitProgress?.({ projectId: "pending", stage: "metadata", message: "Analyse de la vidéo YouTube..." });
  const metadataText = await runYtdlp(
    ytdlp,
    [
      "--no-playlist",
      "--ffmpeg-location",
      ffmpeg,
      "-J",
      "--",
      sourceUrl,
    ],
    libraryDir(),
    undefined,
    signal,
  );
  const metadata = parseYtdlpMetadata(metadataText);
  assertYoutubeMetadata(metadata);
  const youtubeId = metadata.id || randomUUID();
  const existingProject = await findProjectByYoutubeId(youtubeId);
  if (existingProject && existingProject.id !== existingTarget?.id) {
    throw duplicateProjectError(existingProject);
  }
  let id = existingTarget?.id ?? slugify(`youtube_${youtubeId}`);
  if (!existingTarget && (await pathExists(projectDir(id)))) {
    id = slugify(`youtube_${youtubeId}_${Date.now()}`);
  }
  const dir = projectDir(id);
  await fs.mkdir(dir, { recursive: true });
  const downloadDir = await fs.mkdtemp(path.join(dir, ".download-"));
  emitProgress?.({ projectId: id, stage: "download", percent: 0, message: "Téléchargement MP4 compatible..." });

  const outputTemplate = path.join(downloadDir, "source.%(ext)s");
  const allowedFormats = youtubeFormatOptions(metadata).map((format) => format.formatSelector);
  const selectedFormat = safeFormatSelector(request.formatSelector, allowedFormats, BEST_MERGED_FORMAT);
  const downloadArgs = (format: string, cleanStart = false): string[] => [
      "--no-warnings",
      "--no-playlist",
      "--ffmpeg-location",
      ffmpeg,
      "-f",
      format,
      ...(cleanStart ? ["--no-continue", "--force-overwrites"] : []),
      "--merge-output-format",
      "mp4",
      "--progress",
      "--newline",
      "--progress-template",
      "download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
      "--print",
      "after_move:filepath",
      "-o",
      outputTemplate,
      "--",
      sourceUrl,
    ];

  let videoPath = "";
  try {
    let downloadOutput: string;
    try {
      downloadOutput = await runYtdlp(
        ytdlp,
        downloadArgs(selectedFormat, true),
        downloadDir,
        (chunk) => handleYtdlpProgressChunk(chunk, id, emitProgress),
        signal,
      );
    } catch (error) {
      if (!isHttp403YtdlpError(error) || signal?.aborted) throw error;
      emitProgress?.({
        projectId: id,
        stage: "download",
        percent: 0,
        message: "YouTube refuse ce flux, nouvel essai avec un format alternatif...",
      });
      await removeGeneratedSourceFiles(downloadDir);
      downloadOutput = await runYtdlp(
        ytdlp,
        downloadArgs("18/b[ext=mp4]/best", true),
        downloadDir,
        (chunk) => handleYtdlpProgressChunk(chunk, id, emitProgress),
        signal,
      );
    }

    const printedPath = lastOutputLine(downloadOutput);
    const temporaryVideo = path.isAbsolute(printedPath) ? printedPath : path.resolve(downloadDir, printedPath);
    await assertInsideLibrary(temporaryVideo);
    if (!(await pathExists(temporaryVideo))) throw new Error("yt-dlp did not produce the expected video file");
    const streams = await mediaStreams(temporaryVideo, ffmpeg);
    if (!streams.video || !streams.audio) throw new Error("Downloaded media must contain both video and audio streams");
    const extension = path.extname(temporaryVideo) || ".mp4";
    videoPath = path.join(dir, `source${extension}`);
    await removeGeneratedSourceFiles(dir);
    await fs.rename(temporaryVideo, videoPath);
  } finally {
    await fs.rm(downloadDir, { recursive: true, force: true });
  }
  emitProgress?.({ projectId: id, stage: "done", percent: 100, message: "Téléchargement terminé" });

  const project: DesktopProject = {
    ...(existingTarget ?? { id, createdAt: nowIso(), updatedAt: nowIso(), title: id }),
    id,
    title: existingTarget?.titleCustomizedAt
      ? existingTarget.title
      : request.title?.trim() || metadata.title || existingTarget?.title || id,
    createdAt: existingTarget?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    youtubeUrl: metadata.webpage_url || existingTarget?.youtubeUrl || sourceUrl,
    youtubeId,
    youtubeUrlUnverified: undefined,
    youtubeUrlWarning: undefined,
    videoPath,
    durationSeconds: metadata.duration,
  };
  await writeProject(project);
  return { project, videoPath };
}

function transcriptCameFromGroq(transcript: WorkspaceTranscript | null): boolean {
  return transcript?.source_transcript === "groq-cloud";
}

export async function loadProject(projectId: string): Promise<DesktopProjectLoad> {
  let project = await refreshProjectArtifactPaths(await readProject(projectId));
  const transcript = await loadSavedTranscript(projectId);
  if (!project.groqTranscribedAt && transcriptCameFromGroq(transcript)) {
    project = { ...project, groqTranscribedAt: transcript?.created_at || nowIso() };
    await writeProject(project);
  }
  const translationPath = translationFile(projectId);
  const translation = (await pathExists(translationPath))
    ? await readJson<WorkspaceTranslation>(translationPath)
    : null;
  if (transcript && translation) assertTranslationAlignment(transcript, translation);
  const snapshotCurrent = transcriptWithTranslation(transcript, translation);
  if (snapshotCurrent) await ensureInitialSnapshot(projectId, snapshotCurrent);
  return {
    project,
    mediaUrl: project.videoPath ? projectMediaUrl(project.id) : undefined,
    transcript,
    translation,
    snapshots: await listSnapshotInfo(projectId, snapshotCurrent),
    recovery: await recoveryState(projectId),
  };
}

export async function resolveProjectMediaPath(projectId: string): Promise<string> {
  return await requireProjectVideo(await readProject(projectId));
}

export async function projectForTranscription(projectId: string): Promise<DesktopProject> {
  const project = await readProject(projectId);
  const existingTranscript = project.groqTranscribedAt ? null : await loadSavedTranscript(projectId);
  if (project.groqTranscribedAt || transcriptCameFromGroq(existingTranscript)) {
    throw new Error("Ce projet a déjà été transcrit avec Groq. Un second appel est bloqué pour éviter une dépense inutile.");
  }
  const videoPath = await requireProjectVideo(project);
  if (project.durationSeconds && project.durationSeconds > 0) return project;
  const streams = await mediaStreams(videoPath, await resolveTool("ffmpeg"));
  if (!streams.duration) throw new Error("Durée de la vidéo impossible à déterminer");
  const updated = { ...project, durationSeconds: streams.duration, updatedAt: nowIso() };
  await writeProject(updated);
  return updated;
}

export async function saveGeneratedTranscript(
  projectId: string,
  transcript: WorkspaceTranscript,
): Promise<DesktopProjectLoad> {
  const project = await readProject(projectId);
  await requireProjectVideo(project);
  const clean = transcriptWithoutSegmentTranslations(validateTranscript(transcript));
  const previousTranscript = await loadSavedTranscript(projectId);
  if (previousTranscript) await writeSnapshot(projectId, previousTranscript, "pre_groq");
  const previousTranslationPath = translationFile(projectId);
  if (await pathExists(previousTranslationPath)) {
    const previousTranslation = await readJson<WorkspaceTranslation>(previousTranslationPath);
    await writeTranslationSnapshot(projectId, previousTranslation, "pre_groq");
    await fs.rm(previousTranslationPath, { force: true });
  }
  clean.corpus_id = projectId;
  clean.created_at = clean.created_at || nowIso();
  clean.updated_at = nowIso();
  await writeJson(transcriptFile(projectId), clean);
  await writeJson(currentFile(projectId), clean);
  await writeSnapshot(projectId, clean, "generated");
  await writeProject({
    ...project,
    updatedAt: nowIso(),
    transcriptPath: transcriptFile(projectId),
    translationPath: undefined,
    groqTranscribedAt: nowIso(),
  });
  return await loadProject(projectId);
}

export async function saveCurrentTranscript(projectId: string, transcript: WorkspaceTranscript): Promise<DesktopProjectLoad> {
  const project = await readProject(projectId);
  const clean = validateTranscript(transcript);
  clean.corpus_id = projectId;
  clean.updated_at = nowIso();
  await writeJson(currentFile(projectId), clean);
  await writeProject({ ...project, updatedAt: nowIso(), transcriptPath: transcriptFile(projectId) });
  return await loadProject(projectId);
}

export async function createTranscriptSnapshot(projectId: string, transcript: WorkspaceTranscript): Promise<DesktopProjectLoad> {
  const project = await readProject(projectId);
  const clean = validateTranscript(transcript);
  clean.corpus_id = projectId;
  clean.updated_at = nowIso();
  const plainTranscript = transcriptWithoutSegmentTranslations(clean);
  await writeJson(currentFile(projectId), plainTranscript);
  await writeJson(transcriptFile(projectId), plainTranscript);
  await writeSnapshot(projectId, clean);
  const hasTranslation = transcriptHasSegmentTranslations(clean);
  if (hasTranslation) {
    const translation = translationFromTranscriptSnapshot(projectId, clean);
    await writeJson(translationFile(projectId), translation);
    await writeTranslationSnapshot(projectId, translation);
  }
  await writeProject({
    ...project,
    updatedAt: nowIso(),
    transcriptPath: transcriptFile(projectId),
    translationPath: hasTranslation ? translationFile(projectId) : project.translationPath,
  });
  return await loadProject(projectId);
}

export async function loadSnapshot(projectId: string, snapshotId: string): Promise<{ snapshot: DesktopSnapshotInfo; transcript: WorkspaceTranscript }> {
  assertSafeSnapshotId(snapshotId);
  const filePath = path.join(snapshotsDir(projectId), snapshotId);
  await assertInsideLibrary(filePath);
  if (!(await pathExists(filePath))) throw new Error("Sauvegarde inconnue");
  const current = transcriptWithTranslation(
    await loadSavedTranscript(projectId),
    (await pathExists(translationFile(projectId))) ? await readJson<WorkspaceTranslation>(translationFile(projectId)) : null,
  );
  return {
    snapshot: await snapshotInfo(filePath, current),
    transcript: validateTranscript(await readJson<WorkspaceTranscript>(filePath)),
  };
}

export async function restoreSnapshot(projectId: string, snapshotId?: string): Promise<DesktopProjectLoad> {
  if (snapshotId) assertSafeSnapshotId(snapshotId);
  const filePath = snapshotId ? path.join(snapshotsDir(projectId), snapshotId) : await latestSnapshot(projectId);
  if (!filePath) throw new Error("Aucune sauvegarde à restaurer");
  await assertInsideLibrary(filePath);
  const snapshot = validateTranscript(await readJson<WorkspaceTranscript>(filePath));
  const current = transcriptWithTranslation(
    await loadSavedTranscript(projectId),
    (await pathExists(translationFile(projectId))) ? await readJson<WorkspaceTranslation>(translationFile(projectId)) : null,
  );
  if (current && transcriptsDiffer(current, snapshot)) await writeSnapshot(projectId, current, "pre_restore");
  snapshot.corpus_id = projectId;
  snapshot.updated_at = nowIso();
  const plainSnapshot = transcriptWithoutSegmentTranslations(snapshot);
  await writeJson(currentFile(projectId), plainSnapshot);
  await writeJson(transcriptFile(projectId), plainSnapshot);
  const hasTranslation = transcriptHasSegmentTranslations(snapshot);
  if (hasTranslation) {
    const translation = translationFromTranscriptSnapshot(projectId, snapshot);
    await writeJson(translationFile(projectId), translation);
    await writeTranslationSnapshot(projectId, translation, "restore");
  }
  await writeSnapshot(projectId, snapshot, "restore");
  return await loadProject(projectId);
}

export async function importTranslationFile(projectId: string): Promise<ImportTranslationResult | null> {
  const project = await readProject(projectId);
  const transcript = await loadSavedTranscript(projectId);
  await requireProjectVideo(project);
  if (!transcript) throw new Error("Importe d'abord une transcription");
  const selection = await dialog.showOpenDialog({
    title: `Importer une traduction pour ${project.title}`,
    properties: ["openFile"],
    filters: [
      { name: "Traduction Tarjama Studio", extensions: ["json", "md", "markdown", "txt"] },
      { name: "JSON", extensions: ["json"] },
      { name: "Markdown ou texte", extensions: ["md", "markdown", "txt"] },
      { name: "Tous les fichiers", extensions: ["*"] },
    ],
  });
  if (selection.canceled || !selection.filePaths[0]) return null;
  return await importTranslationContent(projectId, await readTextFileLimited(selection.filePaths[0]), path.basename(selection.filePaths[0]), true);
}

export async function importTranslationContent(
  projectId: string,
  content: string,
  filename: string,
  replace: boolean,
): Promise<ImportTranslationResult> {
  assertTextSize(content);
  const project = await readProject(projectId);
  const transcript = await loadSavedTranscript(projectId);
  await requireProjectVideo(project);
  if (!transcript) throw new Error("Importe d'abord une transcription");
  const target = translationFile(projectId);
  if (!replace && (await pathExists(target))) {
    throw new Error("Une traduction existe déjà");
  }
  if (await pathExists(target)) {
    await writeTranslationSnapshot(projectId, await readJson<WorkspaceTranslation>(target), "pre_replace");
  }
  const translation = translationFromImportContent(projectId, transcript, content, filename);
  await writeJson(target, translation);
  await writeTranslationSnapshot(projectId, translation, "import");
  const updatedProject = { ...project, updatedAt: nowIso(), translationPath: target };
  await writeProject(updatedProject);
  return { project: updatedProject, translation };
}

export async function saveTranslation(projectId: string, translation: WorkspaceTranslation): Promise<DesktopProjectLoad> {
  const project = await readProject(projectId);
  const transcript = await loadSavedTranscript(projectId);
  if (!transcript) throw new Error("Importe d'abord une transcription");
  assertTranslationAlignment(transcript, translation);
  const clean = structuredClone(translation) as WorkspaceTranslation;
  clean.corpus_id = projectId;
  clean.source_transcript_fingerprint = transcriptAlignmentFingerprint(transcript);
  clean.updated_at = nowIso();
  await writeJson(translationFile(projectId), clean);
  await writeProject({ ...project, updatedAt: nowIso(), translationPath: translationFile(projectId) });
  return await loadProject(projectId);
}

function assTimestamp(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const cs = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const secs = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assText(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\\N");
}

function displayTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const secs = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function exportFilenameTitle(title: string): string {
  const clean = title
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  if (!clean) return "Tarjama_Studio";
  const usable = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean) ? `${clean}_video` : clean;
  const maximumLength = 100;
  if (usable.length <= maximumLength) return usable;
  const cut = usable.slice(0, maximumLength - 1);
  const lastSeparator = cut.lastIndexOf("_");
  const compact = lastSeparator >= Math.floor(maximumLength * 0.6) ? cut.slice(0, lastSeparator) : cut;
  return compact.replace(/_+$/g, "");
}

async function writeAssSubtitles(
  filePath: string,
  cues: ExportCue[],
  style: ExportSubtitleStyle,
  track: ExportSubtitleTrack,
  dimensions: VideoDimensions,
  fontSize: number,
): Promise<void> {
  const usable = cues.filter((cue) => cue.text.trim() && cue.end > cue.start);
  if (!usable.length) throw new Error("Aucun sous-titre non vide à exporter");
  const fontName = track === "translation" ? LATIN_SUBTITLE_FONT_NAME : ARABIC_SUBTITLE_FONT_NAME;
  const horizontalMargin = Math.max(20, Math.round(dimensions.width * 0.05));
  const verticalMargin = Math.max(18, Math.round(dimensions.height * 0.058));
  const defaultStyle =
    style === "black-band"
      ? `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&HC0000000,0,0,0,0,100,100,0,0,3,1,0,2,${horizontalMargin},${horizontalMargin},${verticalMargin},1`
      : `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1.6,0,2,${horizontalMargin},${horizontalMargin},${verticalMargin},1`;
  const lines = [
    "[Script Info]",
    "Title: Tarjama Studio export",
    "ScriptType: v4.00+",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${dimensions.width}`,
    `PlayResY: ${dimensions.height}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    defaultStyle,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  for (const cue of usable) {
    lines.push(`Dialogue: 0,${assTimestamp(cue.start)},${assTimestamp(cue.end)},Default,,0,0,0,,${assText(cue.text)}`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

function ffmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function subtitleFilter(assPath: string): Promise<string> {
  const fontsDir = await resolveDesktopResource(path.join("desktop-bin", "fonts"));
  const base = `subtitles='${ffmpegFilterPath(assPath)}'`;
  if (!fontsDir) return base;
  return `${base}:fontsdir='${ffmpegFilterPath(fontsDir)}'`;
}

export async function exportVideo(
  projectId: string,
  track: ExportSubtitleTrack,
  openAfter = false,
  requestedOptions?: Partial<ExportVideoOptions>,
  emitProgress?: (progress: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<DesktopExportResult | null> {
  const options = normalizeExportOptions(requestedOptions);
  const project = await readProject(projectId);
  const transcript = await loadSavedTranscript(projectId);
  if (!transcript) throw new Error("Transcription absente");
  const videoPath = await requireProjectVideo(project);
  const sourceCues =
    track === "arabic"
      ? transcript.segments.map((segment) => ({
          start: segment.start,
          end: segment.end,
          text: segment.text,
        }))
      : await (async () => {
          const translationPath = translationFile(projectId);
          if (!(await pathExists(translationPath))) throw new Error("Importe une traduction avant l'export");
          const translation = await readJson<WorkspaceTranslation>(translationPath);
          assertTranslationAlignment(transcript, translation);
          return translation.segments.map((segment) => ({
            start: segment.start,
            end: segment.end,
            text: segment.translation,
          }));
        })();
  const groupedCues = groupExportCues(sourceCues, options.cueGrouping, options.minimumWords);
  const cues = track === "arabic"
    ? groupedCues.map((cue) => ({ ...cue, text: `[${displayTimecode(cue.start)}] ${cue.text}` }))
    : groupedCues;

  const language = track === "arabic" ? "ar" : "fr";
  const defaultName = `${exportFilenameTitle(project.title)}_${language}.mp4`;
  const selection = await dialog.showSaveDialog({
    title: track === "arabic" ? "Exporter la vidéo sous-titrée en arabe" : "Exporter la vidéo avec traduction",
    defaultPath: defaultName,
    filters: [{ name: "Vidéo MP4", extensions: ["mp4"] }],
  });
  if (selection.canceled || !selection.filePath) return null;

  const outDir = exportsDir(projectId);
  const stem = `${filenameTimestamp()}_${createHash("sha1").update(selection.filePath).digest("hex").slice(0, 8)}`;
  const assPath = path.join(outDir, `${stem}.ass`);
  const ffmpeg = await resolveTool("ffmpeg");
  const streams = await mediaStreams(videoPath, ffmpeg);
  if (!streams.width || !streams.height) {
    throw new Error("Les dimensions de la vidéo sont impossibles à déterminer pour calculer des sous-titres lisibles");
  }
  const sourceDimensions = { width: streams.width, height: streams.height };
  const targetDimensions = outputDimensions(sourceDimensions, options.videoQuality);
  await writeAssSubtitles(
    assPath,
    cues,
    options.style,
    track,
    targetDimensions,
    subtitleFontSize(targetDimensions, options.subtitleSize),
  );
  const durationForProgress = Math.max(project.durationSeconds ?? 0, ...cues.map((cue) => cue.end));
  emitProgress?.({
    projectId,
    track,
    stage: "render",
    percent: 0,
    message: `Export ${track === "arabic" ? "arabe" : "traduction"} en cours`,
  });
  const filters: string[] = [];
  if (targetDimensions.width !== sourceDimensions.width || targetDimensions.height !== sourceDimensions.height) {
    filters.push(`scale=${targetDimensions.width}:${targetDimensions.height}:flags=lanczos`);
  }
  filters.push(await subtitleFilter(assPath));
  const temporaryOutput = path.join(outDir, `${stem}.partial.mp4`);
  try {
    await runTool(
      ffmpeg,
      [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostats",
      "-progress",
      "pipe:1",
      "-y",
      "-i",
      videoPath,
      "-vf",
      filters.join(","),
      "-c:v",
      "libx264",
      "-preset",
      "superfast",
      ...videoEncodingArguments(options.videoQuality),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
        temporaryOutput,
      ],
      projectDir(projectId),
      createFfmpegExportProgressHandler(projectId, track, durationForProgress, emitProgress),
      signal,
    );
    await fs.copyFile(temporaryOutput, selection.filePath);
  } finally {
    await fs.rm(temporaryOutput, { force: true });
  }
  emitProgress?.({
    projectId,
    track,
    stage: "done",
    percent: 100,
    eta: "00:00",
    message: "Export terminé",
  });
  if (!(await pathExists(selection.filePath))) throw new Error("ffmpeg n'a pas produit le fichier attendu");
  if (openAfter) {
    const openError = await shell.openPath(selection.filePath);
    if (openError) throw new Error(`Export créé, mais ouverture impossible: ${openError}`);
  }
  return { outputPath: selection.filePath, mediaUrl: pathToFileURL(selection.filePath).toString(), opened: openAfter };
}

export async function setProjectArchived(projectId: string, archived: boolean): Promise<DesktopProject> {
  const project = await readProject(projectId);
  const updated = {
    ...project,
    updatedAt: nowIso(),
    archivedAt: archived ? nowIso() : undefined,
  };
  await writeProject(updated);
  return updated;
}

export async function renameProject(projectId: string, title: string): Promise<DesktopProject> {
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Le titre du projet ne peut pas être vide");
  if (clean.length > 200) throw new Error("Le titre du projet ne peut pas dépasser 200 caractères");
  const project = await readProject(projectId);
  const updated = { ...project, title: clean, titleCustomizedAt: nowIso(), updatedAt: nowIso() };
  await writeProject(updated);
  return updated;
}

export async function openProjectFolder(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  await assertInsideLibrary(dir);
  await shell.openPath(dir);
}

export async function trashProject(projectId: string): Promise<void> {
  const project = await readProject(projectId);
  const dir = projectDir(projectId);
  await assertInsideLibrary(dir);
  const confirmation = await dialog.showMessageBox({
    type: "warning",
    title: "Déplacer le projet à la corbeille",
    message: `Déplacer « ${project.title} » à la corbeille ?`,
    detail: "La bibliothèque des autres projets ne sera pas modifiée.",
    buttons: ["Annuler", "Déplacer à la corbeille"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (confirmation.response !== 1) return;
  await shell.trashItem(dir);
}
