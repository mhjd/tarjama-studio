import { app, BrowserWindow, clipboard, dialog, ipcMain as rawIpcMain, net, protocol, session } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createYoutubeProject,
  createLocalProject,
  createTranscriptSnapshot,
  confirmProjectReview,
  downloadYoutube,
  exportVideo,
  importLocalVideo,
  importTranslationContent,
  importTranslationFile,
  importTranscript,
  importTranscriptContent,
  importCleanedTranscriptContent,
  importCleanedTranscriptFile,
  listYoutubeFormats,
  loadProject,
  loadSnapshot,
  openProjectFolder,
  pickTextImport,
  readLibrary,
  restoreSnapshot,
  saveCurrentTranscript,
  saveTranslation,
  setProjectArchived,
  trashProject,
  updateYtdlp,
  projectForTranscription,
  resolveTool,
  saveGeneratedTranscript,
  renderCleanupPrompt,
  renderTranslationPrompt,
  readPromptSettings,
  renameProject,
  resolveProjectMediaPath,
  resetPromptOverride,
  savePromptOverride,
} from "./library.js";
import { clearGroqApiKey, groqKeyStatus, saveGroqApiKey, transcribeWithGroq } from "./groq.js";
import { isLoopbackDevServer, mediaProjectIdFromPath, safeByteRange, safeRendererAssetPath } from "./security.js";
import type {
  CreateYoutubeProjectRequest,
  DownloadYoutubeRequest,
  ExportSubtitleTrack,
  ExportVideoOptions,
  LongOperationKind,
  PromptKind,
  ProjectReviewKind,
  WorkspaceTranscript,
  WorkspaceTranslation,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ORIGIN = "tarjama://app";
const MAX_CLIPBOARD_TEXT_BYTES = 16 * 1024 * 1024;
let startupLogFile = "";
let mainWindow: BrowserWindow | null = null;
const operationControllers = new Map<LongOperationKind, AbortController>();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "tarjama",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
    },
  },
]);

type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error("IPC request rejected: untrusted renderer");
  }
}

const ipcMain = {
  handle(channel: string, handler: IpcHandler): void {
    rawIpcMain.handle(channel, (event, ...args) => {
      assertTrustedIpcSender(event);
      return handler(event, ...args);
    });
  },
};

function migrateLegacyLibrary(): void {
  const userData = app.getPath("userData");
  const projects = path.join(userData, "projects");
  if (fs.existsSync(projects)) return;

  for (const legacyName of ["Ashrafent", "Electron"]) {
    const legacyDirectory = path.join(app.getPath("appData"), legacyName);
    const legacyProjects = path.join(legacyDirectory, "projects");
    if (!fs.existsSync(legacyProjects)) continue;
    try {
      fs.mkdirSync(userData, { recursive: true });
      fs.cpSync(legacyProjects, projects, { recursive: true, errorOnExist: true });
      for (const filename of ["prompt-overrides.json", "groq-settings.json"]) {
        const source = path.join(legacyDirectory, filename);
        const target = path.join(userData, filename);
        if (fs.existsSync(source) && !fs.existsSync(target)) fs.copyFileSync(source, target);
      }
      console.log(`Migrated local library from ${legacyName}`);
      return;
    } catch (error) {
      console.error(`Unable to migrate local library from ${legacyName}`, error);
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error && error.stack ? error.stack : String(error);
}

function writeStartupLog(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  console.log(line.trim());
  if (!startupLogFile) return;
  try {
    fs.appendFileSync(startupLogFile, line, "utf8");
  } catch {
    // Logging must never prevent the application from opening.
  }
}

function initializeStartupLog(): void {
  const directory = app.getPath("userData");
  try {
    fs.mkdirSync(directory, { recursive: true });
    startupLogFile = path.join(directory, "startup.log");
    fs.writeFileSync(startupLogFile, "", "utf8");
    writeStartupLog(`Starting Tarjama Studio ${app.getVersion()} on ${process.platform}-${process.arch}`);
  } catch (error) {
    console.error("Unable to initialize startup log", error);
  }
}

function reportStartupFailure(context: string, error: unknown): void {
  const detail = errorText(error);
  writeStartupLog(`${context}: ${detail}`);
  dialog.showErrorBox(
    "Tarjama Studio n’a pas pu démarrer",
    `${context}.\n\nConsulte le fichier startup.log dans :\n${app.getPath("userData")}\n\n${detail}`,
  );
}

function createWindow(): void {
  writeStartupLog("Creating main window");
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow = window;

  const devServer = process.env.TARJAMA_VITE_DEV_SERVER;
  if (devServer) {
    if (!isLoopbackDevServer(devServer)) {
      reportStartupFailure("Serveur de développement refusé", new Error("TARJAMA_VITE_DEV_SERVER doit être local"));
      window.close();
      return;
    }
    void window.loadURL(devServer).catch((error) => reportStartupFailure("Chargement de l’interface impossible", error));
  } else {
    void window.loadURL(`${APP_ORIGIN}/index.html`).catch((error) => reportStartupFailure("Chargement de l’interface impossible", error));
  }
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== window.webContents.getURL()) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("did-finish-load", () => writeStartupLog("Renderer finished loading"));
  window.webContents.on("did-fail-load", (_event, code, description, validatedUrl) => {
    writeStartupLog(`Renderer failed to load (${code}): ${description} (${validatedUrl})`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    reportStartupFailure(`Le processus d’interface s’est arrêté (${details.reason})`, details.exitCode);
  });
  window.on("unresponsive", () => writeStartupLog("Main window is unresponsive"));
  window.on("closed", () => {
    operationControllers.forEach((controller) => controller.abort());
    operationControllers.clear();
    if (mainWindow === window) mainWindow = null;
  });
}

async function localFileResponse(filePath: string, request: Request): Promise<Response> {
  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) {
    return await net.fetch(pathToFileURL(filePath).toString(), {
      method: request.method,
      headers: request.headers,
    });
  }

  const size = (await fs.promises.stat(filePath)).size;
  const range = safeByteRange(rangeHeader, size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` },
    });
  }
  const upstream = await net.fetch(pathToFileURL(filePath).toString(), {
    method: request.method,
    headers: request.headers,
  });
  const headers = new Headers(upstream.headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(range.end - range.start + 1));
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: 206, headers });
}

function registerLocalProtocol(): void {
  const rendererRoot = path.resolve(__dirname, "../dist");
  protocol.handle("tarjama", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "app") return new Response("Not found", { status: 404 });
      const decodedPath = decodeURIComponent(url.pathname);
      if (decodedPath.startsWith("/media/")) {
        const projectId = mediaProjectIdFromPath(decodedPath);
        if (!projectId) return new Response("Not found", { status: 404 });
        return await localFileResponse(await resolveProjectMediaPath(projectId), request);
      }

      return await localFileResponse(safeRendererAssetPath(rendererRoot, decodedPath), request);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function registerIpc(): void {
  ipcMain.handle("clipboard:write-text", async (_event, text: string) => {
    if (typeof text !== "string") throw new Error("Texte de presse-papiers invalide");
    if (Buffer.byteLength(text, "utf8") > MAX_CLIPBOARD_TEXT_BYTES) {
      throw new Error("Le texte à copier dépasse la limite de 16 Mio");
    }
    clipboard.writeText(text);
  });
  ipcMain.handle("library:read", async () => readLibrary());
  ipcMain.handle("project:load", async (_event, projectId: string) => loadProject(projectId));
  ipcMain.handle("project:save-current", async (_event, projectId: string, transcript: WorkspaceTranscript) =>
    saveCurrentTranscript(projectId, transcript),
  );
  ipcMain.handle("project:create-snapshot", async (_event, projectId: string, transcript: WorkspaceTranscript) =>
    createTranscriptSnapshot(projectId, transcript),
  );
  ipcMain.handle(
    "project:confirm-review",
    async (_event, projectId: string, kind: ProjectReviewKind, transcript: WorkspaceTranscript) =>
      confirmProjectReview(projectId, kind, transcript),
  );
  ipcMain.handle("project:load-snapshot", async (_event, projectId: string, snapshotId: string) =>
    loadSnapshot(projectId, snapshotId),
  );
  ipcMain.handle("project:restore-snapshot", async (_event, projectId: string, snapshotId?: string) =>
    restoreSnapshot(projectId, snapshotId),
  );
  ipcMain.handle("transcript:import", async (_event, projectId: string) => importTranscript(projectId));
  ipcMain.handle("import:pick-text", async (_event, kind: "transcript" | "cleanup" | "translation") => pickTextImport(kind));
  ipcMain.handle("transcript:import-content", async (_event, projectId: string, content: string, filename: string) =>
    importTranscriptContent(projectId, content, filename),
  );
  ipcMain.handle("transcript:cleanup-prompt", async (_event, projectId: string, transcript: WorkspaceTranscript) =>
    renderCleanupPrompt(projectId, transcript),
  );
  ipcMain.handle("translation:prompt", async (_event, projectId: string, transcript: WorkspaceTranscript) =>
    renderTranslationPrompt(projectId, transcript),
  );
  ipcMain.handle("settings:prompts", async () => readPromptSettings());
  ipcMain.handle("settings:save-prompt", async (_event, kind: PromptKind, content: string) =>
    savePromptOverride(kind, content),
  );
  ipcMain.handle("settings:reset-prompt", async (_event, kind: PromptKind) => resetPromptOverride(kind));
  ipcMain.handle("transcript:import-cleaned-file", async (_event, projectId: string) =>
    importCleanedTranscriptFile(projectId),
  );
  ipcMain.handle("transcript:import-cleaned-content", async (_event, projectId: string, content: string) =>
    importCleanedTranscriptContent(projectId, content),
  );
  ipcMain.handle("translation:import-file", async (_event, projectId: string) => importTranslationFile(projectId));
  ipcMain.handle(
    "translation:import-content",
    async (_event, projectId: string, content: string, filename: string, replace: boolean) =>
      importTranslationContent(projectId, content, filename, replace),
  );
  ipcMain.handle("translation:save", async (_event, projectId: string, translation: WorkspaceTranslation) =>
    saveTranslation(projectId, translation),
  );
  ipcMain.handle(
    "video:export",
    async (
      _event,
      projectId: string,
      track: ExportSubtitleTrack,
      openAfter?: boolean,
      options?: Partial<ExportVideoOptions>,
    ) => withOperation("export", (signal) => exportVideo(
      projectId,
      track,
      Boolean(openAfter),
      options,
      (progress) => _event.sender.send("video:export-progress", progress),
      signal,
    )),
  );
  ipcMain.handle("video:import-local", async (_event, projectId?: string, title?: string) => importLocalVideo(projectId, title));
  ipcMain.handle("project:create-local", async (_event, title: string) => createLocalProject(title));
  ipcMain.handle("youtube:create-project", async (_event, request: CreateYoutubeProjectRequest) =>
    createYoutubeProject(request),
  );
  ipcMain.handle("youtube:list-formats", async (_event, url: string) => listYoutubeFormats(url));
  ipcMain.handle("youtube:download", async (event, request: DownloadYoutubeRequest) =>
    withOperation("download", (signal) => downloadYoutube(
      request,
      (progress) => event.sender.send("youtube:progress", progress),
      signal,
    )),
  );
  ipcMain.handle("tools:update-ytdlp", async () => updateYtdlp());
  ipcMain.handle("groq:key-status", async () => groqKeyStatus());
  ipcMain.handle("groq:save-key", async (_event, apiKey: string) => saveGroqApiKey(apiKey));
  ipcMain.handle("groq:clear-key", async () => clearGroqApiKey());
  ipcMain.handle("groq:transcribe", async (event, projectId: string) => withOperation("transcription", async (signal) => {
    const project = await projectForTranscription(projectId);
    const transcript = await transcribeWithGroq(
      projectId,
      project.videoPath!,
      project.durationSeconds ?? 0,
      await resolveTool("ffmpeg"),
      (progress) => event.sender.send("groq:progress", progress),
      signal,
    );
    return await saveGeneratedTranscript(projectId, transcript);
  }));
  ipcMain.handle("operation:cancel", async (_event, kind: LongOperationKind) => {
    const controller = operationControllers.get(kind);
    if (!controller) return false;
    controller.abort();
    return true;
  });
  ipcMain.handle("project:archive", async (_event, projectId: string, archived: boolean) =>
    setProjectArchived(projectId, archived),
  );
  ipcMain.handle("project:rename", async (_event, projectId: string, title: string) => renameProject(projectId, title));
  ipcMain.handle("project:open-folder", async (_event, projectId: string) => openProjectFolder(projectId));
  ipcMain.handle("project:trash", async (_event, projectId: string) => trashProject(projectId));
}

async function withOperation<T>(kind: LongOperationKind, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (operationControllers.has(kind)) throw new Error("Une opération de ce type est déjà en cours");
  const controller = new AbortController();
  operationControllers.set(kind, controller);
  try {
    return await action(controller.signal);
  } finally {
    if (operationControllers.get(kind) === controller) operationControllers.delete(kind);
  }
}

app.setName("Tarjama Studio");
app.enableSandbox();

app.whenReady().then(() => {
  migrateLegacyLibrary();
  initializeStartupLog();
  try {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    registerLocalProtocol();
    registerIpc();
    createWindow();
  } catch (error) {
    reportStartupFailure("Initialisation impossible", error);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  console.error("Tarjama Studio could not initialize", error);
});

process.on("uncaughtException", (error) => reportStartupFailure("Erreur interne", error));
process.on("unhandledRejection", (error) => writeStartupLog(`Promesse non gérée: ${errorText(error)}`));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
