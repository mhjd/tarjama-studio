import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { BUNDLED_GROQ_API_KEY } from "./generated_defaults.js";
import type { GroqKeyStatus, GroqTranscriptionProgress, WorkspaceTranscript } from "./types.js";

const API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3";
const MAX_CHUNK_BYTES = 23 * 1024 * 1024;
const TARGET_CHUNK_SECONDS = 10 * 60;
const CHUNK_OVERLAP_SECONDS = 20;
const MIN_CHUNK_SECONDS = 30;
const SETTINGS_FILE = "groq-settings.json";
const MAX_FFMPEG_ERROR_BYTES = 2 * 1024 * 1024;

type StoredSettings = { apiKey?: string };
type GroqSegment = { start?: unknown; end?: unknown; text?: unknown };
type GroqWord = { start?: unknown; end?: unknown; word?: unknown };
type GroqResponse = { segments?: GroqSegment[]; words?: GroqWord[]; text?: string; error?: { message?: string } };

function wordsInsideSegment(segment: GroqSegment, words: GroqWord[]): GroqWord[] {
  const segmentStart = Number(segment.start);
  const segmentEnd = Number(segment.end);
  return words.filter((word) => {
    const wordStart = Number(word.start);
    const wordEnd = Number(word.end);
    const midpoint = (wordStart + wordEnd) / 2;
    return Number.isFinite(midpoint) && midpoint >= segmentStart && midpoint <= segmentEnd;
  });
}

function prepareGroqSegments(response: GroqResponse): GroqSegment[] {
  const prepared: GroqSegment[] = [];
  for (const segment of response.segments ?? []) {
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    const start = Number(segment.start);
    const end = Number(segment.end);
    const words = wordsInsideSegment(segment, response.words ?? []);
    if (text && end - start <= 8) {
      prepared.push(segment);
      continue;
    }
    if (!words.length) {
      prepared.push(segment);
      continue;
    }
    let group: GroqWord[] = [];
    for (const word of words) {
      group.push(word);
      const groupStart = Number(group[0].start);
      const groupEnd = Number(group.at(-1)?.end);
      if (group.length >= 14 || groupEnd - groupStart >= 6) {
        prepared.push({ start: groupStart, end: groupEnd, text: group.map((item) => String(item.word ?? "").trim()).filter(Boolean).join(" ") });
        group = [];
      }
    }
    if (group.length) {
      prepared.push({
        start: Number(group[0].start),
        end: Number(group.at(-1)?.end),
        text: group.map((item) => String(item.word ?? "").trim()).filter(Boolean).join(" "),
      });
    }
  }
  return prepared;
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readStoredSettings(): Promise<StoredSettings> {
  if (!(await exists(settingsPath()))) return {};
  try {
    return JSON.parse(await fs.readFile(settingsPath(), "utf8")) as StoredSettings;
  } catch {
    return {};
  }
}

async function developmentEnvKey(): Promise<string> {
  if (app.isPackaged) return "";
  const candidates = [path.join(process.cwd(), ".env"), path.join(process.cwd(), "..", ".env")];
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    const content = await fs.readFile(candidate, "utf8");
    const line = content.split(/\r?\n/).find((item) => /^\s*GROQ_API_KEY\s*=/.test(item));
    if (!line) continue;
    return line.replace(/^\s*GROQ_API_KEY\s*=\s*/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return "";
}

function bundledApiKey(): string {
  return BUNDLED_GROQ_API_KEY.trim();
}

async function storedApiKey(): Promise<string> {
  const settings = await readStoredSettings();
  return settings.apiKey?.trim() ?? "";
}

export async function groqKeyStatus(): Promise<GroqKeyStatus> {
  if (await storedApiKey()) return { configured: true, source: "stored" };
  if (bundledApiKey()) return { configured: true, source: "bundled-default" };
  if (await developmentEnvKey()) return { configured: true, source: "development-env" };
  return { configured: false, source: "none" };
}

export async function saveGroqApiKey(apiKey: string): Promise<GroqKeyStatus> {
  const clean = apiKey.trim();
  if (!clean) throw new Error("La clé API Groq est vide");
  if (clean.length > 4096 || /[\r\n]/.test(clean)) throw new Error("La clé API Groq est invalide");
  await fs.writeFile(settingsPath(), `${JSON.stringify({ apiKey: clean }, null, 2)}\n`, { mode: 0o600 });
  return { configured: true, source: "stored" };
}

export async function clearGroqApiKey(): Promise<GroqKeyStatus> {
  await fs.rm(settingsPath(), { force: true });
  return await groqKeyStatus();
}

async function apiKey(): Promise<string> {
  const key = (await storedApiKey()) || bundledApiKey() || (await developmentEnvKey());
  if (!key) throw new Error("Aucune clé Groq configurée. Ajoute ta clé dans les réglages de transcription.");
  return key;
}

async function runFfmpeg(command: string, args: string[], cwd: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let stderr = "";
    let settled = false;
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (Buffer.byteLength(stderr, "utf8") > MAX_FFMPEG_ERROR_BYTES && !settled) {
        settled = true;
        child.kill();
        reject(new Error("Extraction audio interrompue: sortie ffmpeg anormalement volumineuse"));
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve();
      else reject(new Error(`Extraction audio impossible (ffmpeg ${code}): ${stderr.trim().slice(-1200)}`));
    });
  });
}

async function createChunk(
  ffmpeg: string,
  sourcePath: string,
  outputPath: string,
  start: number,
  requestedDuration: number,
): Promise<{ duration: number; bytes: number }> {
  let duration = requestedDuration;
  while (duration >= MIN_CHUNK_SECONDS) {
    await fs.rm(outputPath, { force: true });
    await runFfmpeg(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(start), "-t", String(duration), "-i", sourcePath,
      "-vn", "-map", "0:a:0", "-ar", "16000", "-ac", "1", "-c:a", "flac", outputPath,
    ], path.dirname(outputPath));
    const bytes = (await fs.stat(outputPath)).size;
    if (bytes <= MAX_CHUNK_BYTES) return { duration, bytes };
    duration = Math.floor(duration * 0.75);
  }
  const bytes = (await fs.stat(outputPath)).size;
  throw new Error(
    `Un morceau audio de ${MIN_CHUNK_SECONDS} s pèse ${(bytes / 1024 / 1024).toFixed(1)} MiB, ` +
    `au-dessus de la limite de sécurité de 23 MiB. Vérifie le fichier source.`,
  );
}

async function transcribeChunk(filePath: string, key: string): Promise<GroqResponse> {
  const data = new FormData();
  const bytes = await fs.readFile(filePath);
  data.append("file", new Blob([bytes], { type: "audio/flac" }), path.basename(filePath));
  data.append("model", MODEL);
  data.append("language", "ar");
  data.append("temperature", "0");
  data.append("response_format", "verbose_json");
  data.append("timestamp_granularities[]", "word");
  data.append("timestamp_granularities[]", "segment");
  const response = await fetch(API_URL, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: data });
  const payload = await response.json().catch(() => ({})) as GroqResponse;
  if (response.ok) return payload;
  const detail = payload.error?.message || `HTTP ${response.status}`;
  if (response.status === 413) {
    throw new Error(`Groq a refusé le morceau car il dépasse sa limite d'envoi: ${detail}`);
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const wait = retryAfter ? ` Réessaie dans ${retryAfter} seconde(s).` : " Réessaie après le renouvellement du quota.";
    throw new Error(`Quota Groq atteint (2 h d'audio par heure sur le plan gratuit).${wait} ${detail}`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Clé API Groq refusée (${response.status}). Vérifie la clé dans les réglages.`);
  }
  throw new Error(`Transcription Groq impossible (${response.status}): ${detail}`);
}

export async function transcribeWithGroq(
  projectId: string,
  sourcePath: string,
  durationSeconds: number,
  ffmpeg: string,
  emit?: (progress: GroqTranscriptionProgress) => void,
): Promise<WorkspaceTranscript> {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Durée de la vidéo inconnue; impossible de préparer les morceaux audio");
  }
  const key = await apiKey();
  const tempDir = await fs.mkdtemp(path.join(app.getPath("temp"), "tarjama-groq-"));
  const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const auditDir = path.join(
    app.getPath("userData"),
    "projects",
    projectId,
    "model_outputs",
    "groq_whisper_large_v3",
    runId,
  );
  await fs.mkdir(auditDir, { recursive: true });
  const segments: WorkspaceTranscript["segments"] = [];
  let start = 0;
  let chunkIndex = 0;
  const estimatedChunks = Math.max(1, Math.ceil((durationSeconds - CHUNK_OVERLAP_SECONDS) / (TARGET_CHUNK_SECONDS - CHUNK_OVERLAP_SECONDS)));
  try {
    emit?.({ projectId, stage: "preparing", percent: 0, message: "Préparation de l'audio pour Groq" });
    while (start < durationSeconds - 0.01) {
      chunkIndex += 1;
      const requested = Math.min(TARGET_CHUNK_SECONDS, durationSeconds - start);
      const chunkPath = path.join(tempDir, `chunk-${String(chunkIndex).padStart(3, "0")}.flac`);
      const chunk = await createChunk(ffmpeg, sourcePath, chunkPath, start, requested);
      const chunkCount = Math.max(estimatedChunks, chunkIndex);
      emit?.({
        projectId,
        stage: "uploading",
        chunkIndex,
        chunkCount,
        percent: Math.min(95, ((chunkIndex - 0.5) / chunkCount) * 100),
        message: `Transcription Groq: morceau ${chunkIndex}/${chunkCount} (${(chunk.bytes / 1024 / 1024).toFixed(1)} MiB)`,
      });
      const result = await transcribeChunk(chunkPath, key);
      await fs.writeFile(
        path.join(auditDir, `chunk-${String(chunkIndex).padStart(3, "0")}.json`),
        `${JSON.stringify({ chunk_start: start, chunk_duration: chunk.duration, chunk_bytes: chunk.bytes, response: result }, null, 2)}\n`,
        "utf8",
      );
      if (!Array.isArray(result.segments)) {
        throw new Error(`Groq n'a renvoyé aucun segment horodaté pour le morceau ${chunkIndex}`);
      }
      const repairedSegments = prepareGroqSegments(result);
      const corruptSegments = repairedSegments.filter(
        (segment) => typeof segment.text !== "string" || !segment.text.trim(),
      );
      if (corruptSegments.length) {
        throw new Error(
          `Groq a renvoyé ${corruptSegments.length} passage(s) sans texte ni mots dans le morceau ${chunkIndex}. ` +
          "La transcription n'a pas été enregistrée; réessaie plutôt que de conserver un fichier incomplet.",
        );
      }
      if (chunkIndex > 1) {
        const replacementIndex = segments.findIndex((segment) => segment.start >= start);
        if (replacementIndex >= 0) segments.splice(replacementIndex);
      }
      for (const candidate of repairedSegments) {
        const localStart = Number(candidate.start);
        const localEnd = Number(candidate.end);
        const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
        if (!text || text === '""' || !Number.isFinite(localStart) || !Number.isFinite(localEnd) || localEnd < localStart) continue;
        let absoluteStart = start + localStart;
        const absoluteEnd = Math.min(durationSeconds, start + localEnd);
        const previous = segments.at(-1);
        if (previous && absoluteStart < previous.end) {
          if (chunkIndex > 1 && previous.start < start && previous.end > start && absoluteEnd > previous.end) {
            previous.end = absoluteEnd;
            if (text.length > previous.text.length) previous.text = text;
            continue;
          }
          absoluteStart = previous.end;
        }
        if (absoluteEnd <= absoluteStart) continue;
        segments.push({ id: String(segments.length), start: absoluteStart, end: absoluteEnd, text, translation: "" });
      }
      if (start + chunk.duration >= durationSeconds - 0.01) break;
      start += Math.max(MIN_CHUNK_SECONDS, chunk.duration - CHUNK_OVERLAP_SECONDS);
    }
    if (!segments.length) throw new Error("Groq a renvoyé une transcription vide");
    emit?.({ projectId, stage: "merging", percent: 98, message: "Assemblage des timestamps" });
    segments.sort((left, right) => left.start - right.start || left.end - right.end);
    segments.forEach((segment, index) => { segment.id = String(index); });
    emit?.({ projectId, stage: "done", percent: 100, message: `Transcription terminée: ${segments.length} segments` });
    const now = new Date().toISOString();
    return {
      corpus_id: projectId,
      source_transcript: "groq-cloud",
      source_model: MODEL,
      project_instructions: "",
      segments,
      created_at: now,
      updated_at: now,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
