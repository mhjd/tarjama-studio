import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopLibraryInfo,
  DownloadYoutubeRequest,
  DownloadYoutubeResult,
  ImportTranscriptResult,
} from "./types.js";

const api = {
  readLibrary: (): Promise<DesktopLibraryInfo> => ipcRenderer.invoke("library:read"),
  importTranscript: (projectId: string): Promise<ImportTranscriptResult | null> =>
    ipcRenderer.invoke("transcript:import", projectId),
  downloadYoutube: (request: DownloadYoutubeRequest): Promise<DownloadYoutubeResult> =>
    ipcRenderer.invoke("youtube:download", request),
  openProjectFolder: (projectId: string): Promise<void> => ipcRenderer.invoke("project:open-folder", projectId),
  trashProject: (projectId: string): Promise<void> => ipcRenderer.invoke("project:trash", projectId),
};

contextBridge.exposeInMainWorld("ashrafentDesktop", api);
