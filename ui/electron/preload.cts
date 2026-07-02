import { contextBridge, ipcRenderer } from "electron";
import type {
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
  DesktopExportResult,
} from "./types.js";

const api = {
  readLibrary: (): Promise<DesktopLibraryInfo> => ipcRenderer.invoke("library:read"),
  loadProject: (projectId: string): Promise<DesktopProjectLoad> => ipcRenderer.invoke("project:load", projectId),
  saveCurrentTranscript: (projectId: string, transcript: WorkspaceTranscript): Promise<DesktopProjectLoad> =>
    ipcRenderer.invoke("project:save-current", projectId, transcript),
  createTranscriptSnapshot: (projectId: string, transcript: WorkspaceTranscript): Promise<DesktopProjectLoad> =>
    ipcRenderer.invoke("project:create-snapshot", projectId, transcript),
  loadSnapshot: (
    projectId: string,
    snapshotId: string,
  ): Promise<{ snapshot: DesktopSnapshotInfo; transcript: WorkspaceTranscript }> =>
    ipcRenderer.invoke("project:load-snapshot", projectId, snapshotId),
  restoreSnapshot: (projectId: string, snapshotId?: string): Promise<DesktopProjectLoad> =>
    ipcRenderer.invoke("project:restore-snapshot", projectId, snapshotId),
  importTranscript: (projectId: string): Promise<ImportTranscriptResult | null> =>
    ipcRenderer.invoke("transcript:import", projectId),
  importTranslationFile: (projectId: string): Promise<ImportTranslationResult | null> =>
    ipcRenderer.invoke("translation:import-file", projectId),
  importTranslationContent: (
    projectId: string,
    content: string,
    filename: string,
    replace: boolean,
  ): Promise<ImportTranslationResult> => ipcRenderer.invoke("translation:import-content", projectId, content, filename, replace),
  saveTranslation: (projectId: string, translation: WorkspaceTranslation): Promise<DesktopProjectLoad> =>
    ipcRenderer.invoke("translation:save", projectId, translation),
  exportTranslatedVideo: (projectId: string): Promise<DesktopExportResult | null> =>
    ipcRenderer.invoke("video:export", projectId),
  downloadYoutube: (request: DownloadYoutubeRequest): Promise<DownloadYoutubeResult> =>
    ipcRenderer.invoke("youtube:download", request),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DownloadProgress) => callback(progress);
    ipcRenderer.on("youtube:progress", listener);
    return () => ipcRenderer.removeListener("youtube:progress", listener);
  },
  setProjectArchived: (projectId: string, archived: boolean): Promise<DesktopProject> =>
    ipcRenderer.invoke("project:archive", projectId, archived),
  openProjectFolder: (projectId: string): Promise<void> => ipcRenderer.invoke("project:open-folder", projectId),
  trashProject: (projectId: string): Promise<void> => ipcRenderer.invoke("project:trash", projectId),
};

contextBridge.exposeInMainWorld("ashrafentDesktop", api);
