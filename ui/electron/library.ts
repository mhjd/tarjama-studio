import { app, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  DesktopLibraryInfo,
  DesktopProject,
  DownloadYoutubeRequest,
  DownloadYoutubeResult,
  ImportTranscriptResult,
  WorkspaceTranscript,
} from "./types.js";

const PROJECT_FILE = "project.json";

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

function projectDir(projectId: string): string {
  return path.join(libraryDir(), projectId);
}

function projectFile(projectId: string): string {
  return path.join(projectDir(projectId), PROJECT_FILE);
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

async function runTool(command: string, args: string[], cwd: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} exited with code ${code}\n${output.trim()}`));
      }
    });
  });
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
  const appBin = path.join(app.getPath("userData"), "bin", process.platform, process.arch);
  const extension = process.platform === "win32" ? ".exe" : "";
  const managed = path.join(appBin, `${name}${extension}`);
  if (await pathExists(managed)) return managed;
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

  const transcriptPath = path.join(dir, "transcript.json");
  transcript.corpus_id = project.id;
  transcript.updated_at = nowIso();
  await writeJson(transcriptPath, transcript);

  const updatedProject: DesktopProject = {
    ...project,
    updatedAt: nowIso(),
    transcriptPath,
  };
  await writeProject(updatedProject);
  return { project: updatedProject, transcriptPath, segmentCount: transcript.segments.length };
}

export async function downloadYoutube(request: DownloadYoutubeRequest): Promise<DownloadYoutubeResult> {
  await fs.mkdir(libraryDir(), { recursive: true });
  const ytdlp = await resolveTool("yt-dlp");
  const ffmpeg = await resolveTool("ffmpeg");
  const metadataText = await runTool(ytdlp, ["-J", request.url], libraryDir());
  const metadata = JSON.parse(metadataText) as { id?: string; title?: string; duration?: number; webpage_url?: string };
  const youtubeId = metadata.id || randomUUID();
  const id = slugify(`youtube_${youtubeId}`);
  const dir = projectDir(id);
  await fs.mkdir(dir, { recursive: true });

  await runTool(
    ytdlp,
    [
      "--ffmpeg-location",
      path.dirname(ffmpeg),
      "-f",
      "bv*+ba/best",
      "--merge-output-format",
      "mp4",
      "-o",
      path.join(dir, "source.%(ext)s"),
      request.url,
    ],
    dir,
  );

  const videoPath = path.join(dir, "source.mp4");
  if (!(await pathExists(videoPath))) {
    throw new Error("yt-dlp did not produce source.mp4");
  }
  const streams = await mediaStreams(videoPath, ffmpeg);
  if (!streams.video || !streams.audio) {
    throw new Error("Downloaded media must contain both video and audio streams");
  }

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
