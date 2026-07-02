import { app, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  DesktopExportResult,
  DesktopLibraryInfo,
  DesktopProject,
  DesktopProjectLoad,
  DesktopSnapshotInfo,
  DownloadProgress,
  DownloadYoutubeRequest,
  DownloadYoutubeResult,
  ImportTranslationResult,
  ImportTranscriptResult,
  WorkspaceTranscript,
  WorkspaceTranslation,
} from "./types.js";

const PROJECT_FILE = "project.json";
const TRANSCRIPT_FILE = "transcript.json";
const CURRENT_FILE = "current.json";
const TRANSLATION_FILE = "translation.json";

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
    throw new Error("Refusing to operate outside Ashrafent library");
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
        translation: "",
      })),
    },
    null,
    0,
  );
}

function transcriptsDiffer(left: WorkspaceTranscript | null, right: WorkspaceTranscript | null): boolean {
  return transcriptComparable(left) !== transcriptComparable(right);
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

function translationFromMarkdown(
  projectId: string,
  transcript: WorkspaceTranscript,
  content: string,
  filename: string,
): WorkspaceTranslation {
  const { metadata, sections } = parseTranslationMarkdown(content);
  if (metadata.source_corpus_id && metadata.source_corpus_id !== projectId) {
    throw new Error(`Cette traduction est pour ${metadata.source_corpus_id}; projet attendu: ${projectId}`);
  }
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
    format: metadata.format || "ashrafent-translation-v1",
    source_transcript_fingerprint: transcriptAlignmentFingerprint(transcript),
    imported_from: filename,
    segments,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
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
    child.on("error", reject);
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

function parseYtdlpMetadata(output: string): { id?: string; title?: string; duration?: number; webpage_url?: string } {
  const trimmed = output.trim();
  try {
    const metadata = JSON.parse(trimmed) as { id?: string; title?: string; duration?: number; webpage_url?: string };
    return {
      id: metadata.id,
      title: metadata.title,
      duration: Number.isFinite(Number(metadata.duration)) ? Number(metadata.duration) : undefined,
      webpage_url: metadata.webpage_url,
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
  const extension = process.platform === "win32" ? ".exe" : "";
  const platformKey = `${process.platform}-${process.arch}`;
  const candidates = [
    path.join(process.resourcesPath, "desktop-bin", platformKey, `${name}${extension}`),
    path.join(app.getAppPath(), "desktop-bin", platformKey, `${name}${extension}`),
    path.join(app.getPath("userData"), "bin", platformKey, `${name}${extension}`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return name;
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

export async function importTranscript(projectId: string): Promise<ImportTranscriptResult | null> {
  const projectPath = projectFile(projectId);
  if (!(await pathExists(projectPath))) {
    throw new Error("Project not found");
  }
  const project = await readJson<DesktopProject>(projectPath);
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

export async function downloadYoutube(
  request: DownloadYoutubeRequest,
  emitProgress?: (progress: DownloadProgress) => void,
): Promise<DownloadYoutubeResult> {
  await fs.mkdir(libraryDir(), { recursive: true });
  const ytdlp = await resolveTool("yt-dlp");
  const ffmpeg = await resolveTool("ffmpeg");
  emitProgress?.({ projectId: "pending", stage: "metadata", message: "Analyse de la vidéo YouTube..." });
  const metadataText = await runYtdlp(
    ytdlp,
    [
      "--no-playlist",
      "--ffmpeg-location",
      ffmpeg,
      "-J",
      request.url,
    ],
    libraryDir(),
  );
  const metadata = parseYtdlpMetadata(metadataText);
  assertYoutubeMetadata(metadata);
  const youtubeId = metadata.id || randomUUID();
  let id = slugify(`youtube_${youtubeId}`);
  if (await pathExists(projectDir(id))) {
    id = slugify(`youtube_${youtubeId}_${Date.now()}`);
  }
  const dir = projectDir(id);
  await fs.mkdir(dir, { recursive: true });
  emitProgress?.({ projectId: id, stage: "download", percent: 0, message: "Téléchargement MP4 compatible..." });

  const outputTemplate = path.join(dir, "source.%(ext)s");
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
      request.url,
    ];

  let downloadOutput: string;
  try {
    downloadOutput = await runYtdlp(
      ytdlp,
      downloadArgs("18/b[ext=mp4]/best", true),
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
      downloadArgs("best[ext=mp4]/best", true),
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
    id,
    title: request.title?.trim() || metadata.title || id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    youtubeUrl: metadata.webpage_url || request.url,
    youtubeId,
    videoPath,
    durationSeconds: metadata.duration,
  };
  await writeProject(project);
  return { project, videoPath };
}

export async function loadProject(projectId: string): Promise<DesktopProjectLoad> {
  const project = await readProject(projectId);
  const transcript = await loadSavedTranscript(projectId);
  if (transcript) await ensureInitialSnapshot(projectId, transcript);
  const translationPath = translationFile(projectId);
  const translation = (await pathExists(translationPath))
    ? await readJson<WorkspaceTranslation>(translationPath)
    : null;
  if (transcript && translation) assertTranslationAlignment(transcript, translation);
  return {
    project,
    mediaUrl: project.videoPath ? pathToFileURL(project.videoPath).toString() : undefined,
    transcript,
    translation,
    snapshots: await listSnapshotInfo(projectId, transcript),
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
  await writeJson(currentFile(projectId), clean);
  await writeJson(transcriptFile(projectId), clean);
  await writeSnapshot(projectId, clean);
  await writeProject({ ...project, updatedAt: nowIso(), transcriptPath: transcriptFile(projectId) });
  return await loadProject(projectId);
}

export async function loadSnapshot(projectId: string, snapshotId: string): Promise<{ snapshot: DesktopSnapshotInfo; transcript: WorkspaceTranscript }> {
  const filePath = path.join(snapshotsDir(projectId), snapshotId);
  await assertInsideLibrary(filePath);
  if (!(await pathExists(filePath))) throw new Error("Sauvegarde inconnue");
  const current = await loadSavedTranscript(projectId);
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
  const current = await loadSavedTranscript(projectId);
  if (current && transcriptsDiffer(current, snapshot)) await writeSnapshot(projectId, current, "pre_restore");
  snapshot.corpus_id = projectId;
  snapshot.updated_at = nowIso();
  await writeJson(currentFile(projectId), snapshot);
  await writeJson(transcriptFile(projectId), snapshot);
  await writeSnapshot(projectId, snapshot, "restore");
  return await loadProject(projectId);
}

export async function importTranslationFile(projectId: string): Promise<ImportTranslationResult | null> {
  const project = await readProject(projectId);
  const transcript = await loadSavedTranscript(projectId);
  if (!transcript) throw new Error("Importe d'abord une transcription");
  const selection = await dialog.showOpenDialog({
    title: `Importer une traduction pour ${project.title}`,
    properties: ["openFile"],
    filters: [
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
  if (!transcript) throw new Error("Importe d'abord une transcription");
  const target = translationFile(projectId);
  if (!replace && (await pathExists(target))) {
    throw new Error("Une traduction existe déjà");
  }
  if (await pathExists(target)) {
    await writeTranslationSnapshot(projectId, await readJson<WorkspaceTranslation>(target), "pre_replace");
  }
  const translation = translationFromMarkdown(projectId, transcript, content, filename);
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

async function writeAssSubtitles(filePath: string, translation: WorkspaceTranslation): Promise<void> {
  const usable = translation.segments.filter((segment) => segment.translation.trim() && segment.end > segment.start);
  if (!usable.length) throw new Error("Aucun sous-titre non vide à exporter");
  const lines = [
    "[Script Info]",
    "Title: Ashrafent export",
    "ScriptType: v4.00+",
    "ScaledBorderAndShadow: yes",
    "PlayResX: 1280",
    "PlayResY: 720",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,34,&H00FFFFFF,&H000000FF,&H00000000,&HC0000000,0,0,0,0,100,100,0,0,3,1,0,2,80,80,42,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  for (const segment of usable) {
    lines.push(`Dialogue: 0,${assTimestamp(segment.start)},${assTimestamp(segment.end)},Default,,0,0,0,,${assText(segment.translation)}`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

function ffmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export async function exportTranslatedVideo(projectId: string): Promise<DesktopExportResult | null> {
  const project = await readProject(projectId);
  const transcript = await loadSavedTranscript(projectId);
  if (!transcript) throw new Error("Transcription absente");
  if (!project.videoPath || !(await pathExists(project.videoPath))) throw new Error("Vidéo source absente");
  const translationPath = translationFile(projectId);
  if (!(await pathExists(translationPath))) throw new Error("Importe une traduction avant l'export");
  const translation = await readJson<WorkspaceTranslation>(translationPath);
  assertTranslationAlignment(transcript, translation);

  const defaultName = `${slugify(project.title)}_sous_titres.mp4`;
  const selection = await dialog.showSaveDialog({
    title: "Exporter la vidéo sous-titrée",
    defaultPath: defaultName,
    filters: [{ name: "Vidéo MP4", extensions: ["mp4"] }],
  });
  if (selection.canceled || !selection.filePath) return null;

  const outDir = exportsDir(projectId);
  const stem = `${filenameTimestamp()}_${createHash("sha1").update(selection.filePath).digest("hex").slice(0, 8)}`;
  const assPath = path.join(outDir, `${stem}.ass`);
  await writeAssSubtitles(assPath, translation);
  const ffmpeg = await resolveTool("ffmpeg");
  await runTool(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      project.videoPath,
      "-vf",
      `subtitles='${ffmpegFilterPath(assPath)}'`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      selection.filePath,
    ],
    projectDir(projectId),
  );
  if (!(await pathExists(selection.filePath))) throw new Error("ffmpeg n'a pas produit le fichier attendu");
  return { outputPath: selection.filePath, mediaUrl: pathToFileURL(selection.filePath).toString() };
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
