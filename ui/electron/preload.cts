import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateYoutubeProjectRequest,
  CreateYoutubeProjectResult,
  CreateLocalProjectResult,
  DesktopLibraryInfo,
  ExportProgress,
  ExportSubtitleTrack,
  ExportVideoOptions,
  DesktopProject,
  DesktopProjectLoad,
  DesktopSnapshotInfo,
  DownloadProgress,
  DownloadYoutubeRequest,
  DownloadYoutubeResult,
  ImportTranslationResult,
  ImportTranscriptResult,
  LongOperationKind,
  TextImportSelection,
  UpdateToolResult,
  WorkspaceTranscript,
  WorkspaceTranslation,
  DesktopExportResult,
  YoutubeFormatsResult,
  GroqKeyStatus,
  GroqTranscriptionProgress,
  CleanedTranscriptImportResult,
  DesktopPromptSettings,
  PromptKind,
} from "./types.js";

const api = {
  copyText: (text: string): Promise<void> => ipcRenderer.invoke("clipboard:write-text", text),
  readLibrary: (): Promise<DesktopLibraryInfo> => ipcRenderer.invoke("library:read"),
  loadProject: (projectId: string): Promise<DesktopProjectLoad> => ipcRenderer.invoke("project:load", projectId),
  renameProject: (projectId: string, title: string): Promise<DesktopProject> =>
    ipcRenderer.invoke("project:rename", projectId, title),
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
  pickTextImport: (kind: "transcript" | "cleanup" | "translation"): Promise<TextImportSelection | null> =>
    ipcRenderer.invoke("import:pick-text", kind),
  importTranscriptContent: (projectId: string, content: string, filename: string): Promise<ImportTranscriptResult> =>
    ipcRenderer.invoke("transcript:import-content", projectId, content, filename),
  cleanupTranscriptPrompt: (projectId: string, transcript: WorkspaceTranscript): Promise<string> =>
    ipcRenderer.invoke("transcript:cleanup-prompt", projectId, transcript),
  translationPrompt: (projectId: string, transcript: WorkspaceTranscript): Promise<string> =>
    ipcRenderer.invoke("translation:prompt", projectId, transcript),
  readPromptSettings: (): Promise<DesktopPromptSettings> => ipcRenderer.invoke("settings:prompts"),
  savePrompt: (kind: PromptKind, content: string): Promise<DesktopPromptSettings> =>
    ipcRenderer.invoke("settings:save-prompt", kind, content),
  resetPrompt: (kind: PromptKind): Promise<DesktopPromptSettings> =>
    ipcRenderer.invoke("settings:reset-prompt", kind),
  importCleanedTranscriptFile: (projectId: string): Promise<CleanedTranscriptImportResult | null> =>
    ipcRenderer.invoke("transcript:import-cleaned-file", projectId),
  importCleanedTranscriptContent: (projectId: string, content: string): Promise<CleanedTranscriptImportResult> =>
    ipcRenderer.invoke("transcript:import-cleaned-content", projectId, content),
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
    options?: Partial<ExportVideoOptions>,
  ): Promise<DesktopExportResult | null> => ipcRenderer.invoke("video:export", projectId, track, openAfter, options),
  importLocalVideo: (projectId?: string, title?: string): Promise<DownloadYoutubeResult | null> =>
    ipcRenderer.invoke("video:import-local", projectId, title),
  createLocalProject: (title: string): Promise<CreateLocalProjectResult> =>
    ipcRenderer.invoke("project:create-local", title),
  createYoutubeProject: (request: CreateYoutubeProjectRequest): Promise<CreateYoutubeProjectResult> =>
    ipcRenderer.invoke("youtube:create-project", request),
  listYoutubeFormats: (url: string): Promise<YoutubeFormatsResult> => ipcRenderer.invoke("youtube:list-formats", url),
  downloadYoutube: (request: DownloadYoutubeRequest): Promise<DownloadYoutubeResult> =>
    ipcRenderer.invoke("youtube:download", request),
  updateYtdlp: (): Promise<UpdateToolResult> => ipcRenderer.invoke("tools:update-ytdlp"),
  groqKeyStatus: (): Promise<GroqKeyStatus> => ipcRenderer.invoke("groq:key-status"),
  saveGroqApiKey: (apiKey: string): Promise<GroqKeyStatus> => ipcRenderer.invoke("groq:save-key", apiKey),
  clearGroqApiKey: (): Promise<GroqKeyStatus> => ipcRenderer.invoke("groq:clear-key"),
  transcribeWithGroq: (projectId: string): Promise<DesktopProjectLoad> => ipcRenderer.invoke("groq:transcribe", projectId),
  cancelOperation: (kind: LongOperationKind): Promise<boolean> => ipcRenderer.invoke("operation:cancel", kind),
  onGroqTranscriptionProgress: (callback: (progress: GroqTranscriptionProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: GroqTranscriptionProgress) => callback(progress);
    ipcRenderer.on("groq:progress", listener);
    return () => ipcRenderer.removeListener("groq:progress", listener);
  },
  onDownloadProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DownloadProgress) => callback(progress);
    ipcRenderer.on("youtube:progress", listener);
    return () => ipcRenderer.removeListener("youtube:progress", listener);
  },
  onExportProgress: (callback: (progress: ExportProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ExportProgress) => callback(progress);
    ipcRenderer.on("video:export-progress", listener);
    return () => ipcRenderer.removeListener("video:export-progress", listener);
  },
  setProjectArchived: (projectId: string, archived: boolean): Promise<DesktopProject> =>
    ipcRenderer.invoke("project:archive", projectId, archived),
  openProjectFolder: (projectId: string): Promise<void> => ipcRenderer.invoke("project:open-folder", projectId),
  trashProject: (projectId: string): Promise<void> => ipcRenderer.invoke("project:trash", projectId),
};

contextBridge.exposeInMainWorld("tarjamaDesktop", api);
