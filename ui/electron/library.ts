import { app, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CreateYoutubeProjectRequest,
  CreateYoutubeProjectResult,
  DesktopExportResult,
  DesktopLibraryInfo,
  DesktopProject,
  DesktopProjectLoad,
  DesktopSnapshotInfo,
  ExportProgress,
  ExportSubtitleStyle,
  ExportSubtitleTrack,
  DownloadProgress,
  DownloadYoutubeRequest,
  DownloadYoutubeResult,
  ImportTranslationResult,
  ImportTranscriptResult,
  UpdateToolResult,
  WorkspaceTranscript,
  WorkspaceTranslation,
  YoutubeFormatOption,
  YoutubeFormatsResult,
} from "./types.js";

const PROJECT_FILE = "project.json";
const TRANSCRIPT_FILE = "transcript.json";
const CURRENT_FILE = "current.json";
const TRANSLATION_FILE = "translation.json";
const ARABIC_SUBTITLE_FONT_NAME = "Noto Naskh Arabic";
const LATIN_SUBTITLE_FONT_NAME = "Arial";

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

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
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
  });
  return transcript;
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
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  throw new Error(`Invalid timecode: ${value}`);
}

function sameTime(left: number, right: number): boolean {
  return Number(left.toFixed(3)) === Number(right.toFixed(3));
}

function parseTranslationMarkdown(content: string): { metadata: Record<string, string>; sections: Array<{ start: number; end: number; translation: string }> } {
  const metadata: Record<string, string> = {};
  const sections: Array<{ start: number; end: number; translation: string }> = [];
  let current: { start: number; end: number; lines: string[] } | null = null;
  const heading = /^##\s+(.+?)\s+-->\s+(.+?)\s*$/;
  for (const rawLine of content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    const match = line.match(heading);
    if (match) {
      if (current) sections.push({ start: current.start, end: current.end, translation: current.lines.join("\n").trim() });
      current = { start: parseTimecode(match[1]), end: parseTimecode(match[2]), lines: [] };
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
  if (current) sections.push({ start: current.start, end: current.end, translation: current.lines.join("\n").trim() });
  return { metadata, sections };
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
  const { metadata, sections } = parseTranslationMarkdown(content);
  if (sections.length !== transcript.segments.length) {
    throw new Error(`La traduction contient ${sections.length} segment(s); attendu: ${transcript.segments.length}`);
  }
  const mismatches: number[] = [];
  const segments = transcript.segments.map((source, index) => {
    const translated = sections[index];
    if (!sameTime(source.start, translated.start) || !sameTime(source.end, translated.end)) {
      mismatches.push(index + 1);
    }
    return {
      id: String(source.id),
      start: source.start,
      end: source.end,
      translation: translated.translation,
    };
  });
  if (mismatches.length) {
    throw new Error(`Timestamp non aligné dans le(s) bloc(s): ${mismatches.slice(0, 8).join(", ")}`);
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
    throw new Error(`La traduction contient ${translation.segments.length} segment(s); attendu: ${transcript.segments.length}`);
  }
  const mismatches: number[] = [];
  transcript.segments.forEach((source, index) => {
    const translated = translation.segments[index];
    if (
      String(source.id) !== String(translated.id) ||
      !sameTime(source.start, translated.start) ||
      !sameTime(source.end, translated.end)
    ) {
      mismatches.push(index + 1);
    }
  });
  if (mismatches.length) {
    throw new Error(`Traduction non alignée dans le(s) segment(s): ${mismatches.slice(0, 8).join(", ")}`);
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
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const value = String(chunk);
      stdout += value;
      onOutput?.(value);
    });
    child.stderr.on("data", (chunk) => {
      const value = String(chunk);
      stderr += value;
      onOutput?.(value);
    });
    child.on("error", (error) => {
      reject(new ToolError(`${path.basename(command)} could not be started at ${command}\n${error.message}`, stdout, stderr, null));
    });
    child.on("close", (code) => {
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

function ytdlpDownloadUrl(): string {
  if (process.platform === "darwin") return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
  if (process.platform === "win32") return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
  if (process.platform === "linux") return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
  throw new Error(`Unsupported platform for yt-dlp update: ${process.platform}`);
}

async function downloadFile(url: string, targetPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const tmpPath = `${targetPath}.tmp`;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(tmpPath, Buffer.from(await response.arrayBuffer()));
  await makeExecutable(tmpPath);
  await fs.rm(targetPath, { force: true }).catch(() => undefined);
  await fs.rename(tmpPath, targetPath);
}

export async function updateYtdlp(): Promise<UpdateToolResult> {
  const targetPath = path.join(app.getPath("userData"), "bin", platformKey(), `yt-dlp${executableExtension()}`);
  await downloadFile(ytdlpDownloadUrl(), targetPath);
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
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runTool(command, [...YTDLP_RETRY_ARGS, ...args], cwd, onOutput);
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

async function mediaStreams(filePath: string, ffmpeg: string): Promise<{ audio: boolean; video: boolean }> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-i", filePath], { windowsHide: true });
    let combined = "";
    child.stdout.on("data", (chunk) => {
      combined += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      combined += String(chunk);
    });
    child.on("error", reject);
    child.on("close", () => resolve(combined));
  });
  return { audio: output.includes(" Audio:"), video: output.includes(" Video:") };
}

async function resolveTool(name: "yt-dlp" | "ffmpeg"): Promise<string> {
  const extension = executableExtension();
  const key = platformKey();
  const candidates = [
    path.join(app.getPath("userData"), "bin", key, `${name}${extension}`),
    path.join(process.resourcesPath, "desktop-bin", key, `${name}${extension}`),
    path.join(app.getAppPath(), "desktop-bin", key, `${name}${extension}`),
    path.join(app.getAppPath(), "..", "desktop-bin", key, `${name}${extension}`),
    path.join(process.cwd(), "desktop-bin", key, `${name}${extension}`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error(`Missing bundled ${name}. Run make desktop-tools, then restart the app.`);
}

async function resolveDesktopResource(relativePath: string): Promise<string | null> {
  const candidates = [
    path.join(app.getPath("userData"), relativePath),
    path.join(process.resourcesPath, relativePath),
    path.join(app.getAppPath(), relativePath),
    path.join(app.getAppPath(), "..", relativePath),
    path.join(process.cwd(), relativePath),
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
    const filePath = path.join(root, entry.name, PROJECT_FILE);
    if (!(await pathExists(filePath))) continue;
    projects.push(await readJson<DesktopProject>(filePath));
  }
  projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { libraryDir: root, projects };
}

async function readProject(projectId: string): Promise<DesktopProject> {
  const filePath = projectFile(projectId);
  if (!(await pathExists(filePath))) throw new Error("Project not found");
  return await readJson<DesktopProject>(filePath);
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

export async function importTranscript(projectId: string): Promise<ImportTranscriptResult | null> {
  const projectPath = projectFile(projectId);
  if (!(await pathExists(projectPath))) {
    throw new Error("Project not found");
  }
  const project = await readJson<DesktopProject>(projectPath);
  await requireProjectVideo(project);
  const selection = await dialog.showOpenDialog({
    title: `Importer une transcription pour ${project.title}`,
    properties: ["openFile"],
    filters: [{ name: "Transcript JSON", extensions: ["json"] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return null;

  const transcript = validateTranscript(JSON.parse(await fs.readFile(selection.filePaths[0], "utf8")));
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
  };
  await writeProject(updatedProject);
  return { project: updatedProject, videoPath };
}

export async function importLocalVideo(projectId?: string): Promise<DownloadYoutubeResult | null> {
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
  const title = path.basename(sourcePath, extension);
  let id = slugify(`local_${title}`);
  if (await pathExists(projectDir(id))) {
    id = slugify(`local_${title}_${Date.now()}`);
  }
  const project: DesktopProject = {
    id,
    title,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  return await copyVideoIntoProject(project, sourcePath, title);
}

export async function listYoutubeFormats(url: string): Promise<YoutubeFormatsResult> {
  await fs.mkdir(libraryDir(), { recursive: true });
  const ytdlp = await resolveTool("yt-dlp");
  const ffmpeg = await resolveTool("ffmpeg");
  const metadataText = await runYtdlp(
    ytdlp,
    [
      "--no-playlist",
      "--ffmpeg-location",
      ffmpeg,
      "-J",
      url,
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
): Promise<DownloadYoutubeResult> {
  await fs.mkdir(libraryDir(), { recursive: true });
  const ytdlp = await resolveTool("yt-dlp");
  const ffmpeg = await resolveTool("ffmpeg");
  const existingTarget = request.projectId ? await readProject(request.projectId) : null;
  const sourceUrl = request.url.trim() || existingTarget?.youtubeUrl || "";
  if (!sourceUrl) throw new Error("Lien YouTube absent");
  emitProgress?.({ projectId: "pending", stage: "metadata", message: "Analyse de la vidéo YouTube..." });
  const metadataText = await runYtdlp(
    ytdlp,
    [
      "--no-playlist",
      "--ffmpeg-location",
      ffmpeg,
      "-J",
      sourceUrl,
    ],
    libraryDir(),
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
  emitProgress?.({ projectId: id, stage: "download", percent: 0, message: "Téléchargement MP4 compatible..." });

  const outputTemplate = path.join(dir, "source.%(ext)s");
  const selectedFormat = request.formatSelector || BEST_MERGED_FORMAT;
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
      sourceUrl,
    ];

  let downloadOutput: string;
  try {
    downloadOutput = await runYtdlp(
      ytdlp,
      downloadArgs(selectedFormat, true),
      dir,
      (chunk) => handleYtdlpProgressChunk(chunk, id, emitProgress),
    );
  } catch (error) {
    if (!isHttp403YtdlpError(error)) throw error;
    emitProgress?.({
      projectId: id,
      stage: "download",
      percent: 0,
      message: "YouTube refuse ce flux, nouvel essai avec un format alternatif...",
    });
    await removeGeneratedSourceFiles(dir);
    downloadOutput = await runYtdlp(
      ytdlp,
      downloadArgs("18/b[ext=mp4]/best", true),
      dir,
      (chunk) => handleYtdlpProgressChunk(chunk, id, emitProgress),
    );
  }

  const printedPath = lastOutputLine(downloadOutput);
  const videoPath = path.isAbsolute(printedPath) ? printedPath : path.resolve(dir, printedPath);
  await assertInsideLibrary(videoPath);
  if (!(await pathExists(videoPath))) {
    throw new Error("yt-dlp did not produce the expected video file");
  }
  const streams = await mediaStreams(videoPath, ffmpeg);
  if (!streams.video || !streams.audio) {
    throw new Error("Downloaded media must contain both video and audio streams");
  }
  emitProgress?.({ projectId: id, stage: "done", percent: 100, message: "Téléchargement terminé" });

  const project: DesktopProject = {
    ...(existingTarget ?? { id, createdAt: nowIso(), updatedAt: nowIso(), title: id }),
    id,
    title: request.title?.trim() || metadata.title || existingTarget?.title || id,
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

export async function loadProject(projectId: string): Promise<DesktopProjectLoad> {
  const project = await readProject(projectId);
  const transcript = await loadSavedTranscript(projectId);
  const translationPath = translationFile(projectId);
  const translation = (await pathExists(translationPath))
    ? await readJson<WorkspaceTranslation>(translationPath)
    : null;
  if (transcript && translation) assertTranslationAlignment(transcript, translation);
  const snapshotCurrent = transcriptWithTranslation(transcript, translation);
  if (snapshotCurrent) await ensureInitialSnapshot(projectId, snapshotCurrent);
  return {
    project,
    mediaUrl: project.videoPath ? pathToFileURL(project.videoPath).toString() : undefined,
    transcript,
    translation,
    snapshots: await listSnapshotInfo(projectId, snapshotCurrent),
    recovery: await recoveryState(projectId),
  };
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
  return await importTranslationContent(projectId, await fs.readFile(selection.filePaths[0], "utf8"), path.basename(selection.filePaths[0]), true);
}

export async function importTranslationContent(
  projectId: string,
  content: string,
  filename: string,
  replace: boolean,
): Promise<ImportTranslationResult> {
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

type SubtitleCue = {
  start: number;
  end: number;
  text: string;
};

async function writeAssSubtitles(
  filePath: string,
  cues: SubtitleCue[],
  style: ExportSubtitleStyle,
  track: ExportSubtitleTrack,
): Promise<void> {
  const usable = cues.filter((cue) => cue.text.trim() && cue.end > cue.start);
  if (!usable.length) throw new Error("Aucun sous-titre non vide à exporter");
  const fontName = track === "translation" ? LATIN_SUBTITLE_FONT_NAME : ARABIC_SUBTITLE_FONT_NAME;
  const defaultStyle =
    style === "black-band"
      ? `Style: Default,${fontName},34,&H00FFFFFF,&H000000FF,&H00000000,&HC0000000,0,0,0,0,100,100,0,0,3,1,0,2,80,80,42,1`
      : `Style: Default,${fontName},34,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1.6,0,2,80,80,42,1`;
  const lines = [
    "[Script Info]",
    "Title: Tarjama Studio export",
    "ScriptType: v4.00+",
    "ScaledBorderAndShadow: yes",
    "PlayResX: 1280",
    "PlayResY: 720",
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
  style: ExportSubtitleStyle = "black-band",
  emitProgress?: (progress: ExportProgress) => void,
): Promise<DesktopExportResult | null> {
  const subtitleStyle: ExportSubtitleStyle = style === "outline" ? "outline" : "black-band";
  const project = await readProject(projectId);
  const transcript = await loadSavedTranscript(projectId);
  if (!transcript) throw new Error("Transcription absente");
  const videoPath = await requireProjectVideo(project);
  const cues =
    track === "arabic"
      ? transcript.segments.map((segment) => ({
          start: segment.start,
          end: segment.end,
          text: `[${displayTimecode(segment.start)}] ${segment.text}`,
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

  const suffix = track === "arabic" ? "arabe" : "traduction";
  const defaultName = `${slugify(project.title)}_${suffix}.mp4`;
  const selection = await dialog.showSaveDialog({
    title: track === "arabic" ? "Exporter la vidéo sous-titrée en arabe" : "Exporter la vidéo avec traduction",
    defaultPath: defaultName,
    filters: [{ name: "Vidéo MP4", extensions: ["mp4"] }],
  });
  if (selection.canceled || !selection.filePath) return null;

  const outDir = exportsDir(projectId);
  const stem = `${filenameTimestamp()}_${createHash("sha1").update(selection.filePath).digest("hex").slice(0, 8)}`;
  const assPath = path.join(outDir, `${stem}.ass`);
  await writeAssSubtitles(assPath, cues, subtitleStyle, track);
  const ffmpeg = await resolveTool("ffmpeg");
  const durationForProgress = Math.max(project.durationSeconds ?? 0, ...cues.map((cue) => cue.end));
  emitProgress?.({
    projectId,
    track,
    stage: "render",
    percent: 0,
    message: `Export ${track === "arabic" ? "arabe" : "traduction"} en cours`,
  });
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
      await subtitleFilter(assPath),
      "-c:v",
      "libx264",
      "-preset",
      "superfast",
      "-crf",
      "23",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      selection.filePath,
    ],
    projectDir(projectId),
    createFfmpegExportProgressHandler(projectId, track, durationForProgress, emitProgress),
  );
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

export async function openProjectFolder(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  await assertInsideLibrary(dir);
  await shell.openPath(dir);
}

export async function trashProject(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  await assertInsideLibrary(dir);
  await shell.trashItem(dir);
}
