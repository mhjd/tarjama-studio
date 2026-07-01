import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  downloadYoutube,
  importTranscript,
  openProjectFolder,
  readLibrary,
  trashProject,
} from "./library.js";
import type { DownloadYoutubeRequest } from "./types.js";

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
      preload: path.join(__dirname, "preload.js"),
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
  ipcMain.handle("transcript:import", async () => importTranscript());
  ipcMain.handle("youtube:download", async (_event, request: DownloadYoutubeRequest) => downloadYoutube(request));
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
