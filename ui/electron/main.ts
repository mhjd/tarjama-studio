import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createYoutubeProject,
  createTranscriptSnapshot,
  downloadYoutube,
  exportVideo,
  importLocalVideo,
  importTranslationContent,
  importTranslationFile,
  importTranscript,
  listYoutubeFormats,
  loadProject,
  loadSnapshot,
  openProjectFolder,
  readLibrary,
  restoreSnapshot,
  saveCurrentTranscript,
  saveTranslation,
  setProjectArchived,
  trashProject,
  updateYtdlp,
} from "./library.js";
import type {
  CreateYoutubeProjectRequest,
  DownloadYoutubeRequest,
  ExportSubtitleTrack,
  WorkspaceTranscript,
  WorkspaceTranslation,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  const devServer = process.env.ASHRAFENT_VITE_DEV_SERVER;
  if (devServer) {
    void window.loadURL(devServer);
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function registerIpc(): void {
  ipcMain.handle("library:read", async () => readLibrary());
  ipcMain.handle("project:load", async (_event, projectId: string) => loadProject(projectId));
  ipcMain.handle("project:save-current", async (_event, projectId: string, transcript: WorkspaceTranscript) =>
    saveCurrentTranscript(projectId, transcript),
  );
  ipcMain.handle("project:create-snapshot", async (_event, projectId: string, transcript: WorkspaceTranscript) =>
    createTranscriptSnapshot(projectId, transcript),
  );
  ipcMain.handle("project:load-snapshot", async (_event, projectId: string, snapshotId: string) =>
    loadSnapshot(projectId, snapshotId),
  );
  ipcMain.handle("project:restore-snapshot", async (_event, projectId: string, snapshotId?: string) =>
    restoreSnapshot(projectId, snapshotId),
  );
  ipcMain.handle("transcript:import", async (_event, projectId: string) => importTranscript(projectId));
  ipcMain.handle("translation:import-file", async (_event, projectId: string) => importTranslationFile(projectId));
  ipcMain.handle(
    "translation:import-content",
    async (_event, projectId: string, content: string, filename: string, replace: boolean) =>
      importTranslationContent(projectId, content, filename, replace),
  );
  ipcMain.handle("translation:save", async (_event, projectId: string, translation: WorkspaceTranslation) =>
    saveTranslation(projectId, translation),
  );
  ipcMain.handle("video:export", async (_event, projectId: string, track: ExportSubtitleTrack, openAfter?: boolean) =>
    exportVideo(projectId, track, Boolean(openAfter)),
  );
  ipcMain.handle("video:import-local", async (_event, projectId?: string) => importLocalVideo(projectId));
  ipcMain.handle("youtube:create-project", async (_event, request: CreateYoutubeProjectRequest) =>
    createYoutubeProject(request),
  );
  ipcMain.handle("youtube:list-formats", async (_event, url: string) => listYoutubeFormats(url));
  ipcMain.handle("youtube:download", async (event, request: DownloadYoutubeRequest) =>
    downloadYoutube(request, (progress) => event.sender.send("youtube:progress", progress)),
  );
  ipcMain.handle("tools:update-ytdlp", async () => updateYtdlp());
  ipcMain.handle("project:archive", async (_event, projectId: string, archived: boolean) =>
    setProjectArchived(projectId, archived),
  );
  ipcMain.handle("project:open-folder", async (_event, projectId: string) => openProjectFolder(projectId));
  ipcMain.handle("project:trash", async (_event, projectId: string) => trashProject(projectId));
}

registerIpc();

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
