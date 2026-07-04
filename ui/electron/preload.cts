import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateYoutubeProjectRequest,
  CreateYoutubeProjectResult,
  DesktopLibraryInfo,
  ExportSubtitleStyle,
  ExportSubtitleTrack,
  DesktopProject,
  DesktopProjectLoad,
  DesktopSnapshotInfo,
  DownloadProgress,
  DownloadYoutubeRequest,
  DownloadYoutubeResult,
  ImportTranslationResult,
  ImportTranscriptResult,
  UpdateToolResult,
  WorkspaceTranscript,
  WorkspaceTranslation,
  DesktopExportResult,
  YoutubeFormatsResult,
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
  exportVideo: (
    projectId: string,
    track: ExportSubtitleTrack,
    openAfter?: boolean,
    style?: ExportSubtitleStyle,
  ): Promise<DesktopExportResult | null> => ipcRenderer.invoke("video:export", projectId, track, openAfter, style),
  importLocalVideo: (projectId?: string): Promise<DownloadYoutubeResult | null> =>
    ipcRenderer.invoke("video:import-local", projectId),
  createYoutubeProject: (request: CreateYoutubeProjectRequest): Promise<CreateYoutubeProjectResult> =>
    ipcRenderer.invoke("youtube:create-project", request),
  listYoutubeFormats: (url: string): Promise<YoutubeFormatsResult> => ipcRenderer.invoke("youtube:list-formats", url),
  downloadYoutube: (request: DownloadYoutubeRequest): Promise<DownloadYoutubeResult> =>
    ipcRenderer.invoke("youtube:download", request),
  updateYtdlp: (): Promise<UpdateToolResult> => ipcRenderer.invoke("tools:update-ytdlp"),
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
