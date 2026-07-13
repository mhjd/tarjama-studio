type DesktopProject = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  youtubeUrl?: string;
  youtubeId?: string;
  youtubeUrlUnverified?: boolean;
  youtubeUrlWarning?: string;
  videoPath?: string;
  transcriptPath?: string;
  translationPath?: string;
  durationSeconds?: number;
  archivedAt?: string;
};

type DesktopLibraryInfo = {
  libraryDir: string;
  projects: DesktopProject[];
};

type ImportTranscriptResult = {
  project: DesktopProject;
  transcriptPath: string;
  segmentCount: number;
};

type DownloadYoutubeRequest = {
  url: string;
  projectId?: string;
  title?: string;
  formatSelector?: string;
};

type DownloadYoutubeResult = {
  project: DesktopProject;
  videoPath: string;
};

type CreateYoutubeProjectRequest = {
  url: string;
  title?: string;
};

type CreateYoutubeProjectResult = {
  project: DesktopProject;
  warning?: string;
};

type UpdateToolResult = {
  path: string;
  version: string;
};

type YoutubeFormatOption = {
  id: string;
  label: string;
  formatSelector: string;
  height?: number;
  fps?: number;
  ext?: string;
  filesizeApprox?: number;
  note?: string;
};

type YoutubeFormatsResult = {
  title: string;
  duration?: number;
  webpageUrl?: string;
  formats: YoutubeFormatOption[];
};

type DownloadProgress = {
  projectId: string;
  stage: "metadata" | "download" | "mux" | "done";
  message: string;
  percent?: number;
  speed?: string;
  eta?: string;
};

type DesktopSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  translation: string;
};

type DesktopTranscript = {
  corpus_id: string;
  audio_path?: string;
  source_transcript?: string;
  source_model?: string;
  project_instructions?: string;
  segments: DesktopSegment[];
  created_at?: string;
  updated_at?: string;
};

type DesktopTranslation = {
  corpus_id: string;
  language: string;
  format?: string;
  source_transcript_fingerprint: string;
  imported_from?: string | null;
  segments: Array<{
    id: string;
    start: number;
    end: number;
    translation: string;
  }>;
  created_at?: string;
  updated_at?: string;
};

type DesktopSnapshotInfo = {
  id: string;
  created_at?: string | null;
  segment_count: number;
  matches_current?: boolean;
};

type DesktopRecoveryState = {
  needs_resolution: boolean;
  snapshot_path?: string | null;
  snapshot?: DesktopTranscript | null;
};

type DesktopProjectLoad = {
  project: DesktopProject;
  mediaUrl?: string;
  transcript: DesktopTranscript | null;
  translation: DesktopTranslation | null;
  snapshots: DesktopSnapshotInfo[];
  recovery: DesktopRecoveryState;
};

type ImportTranslationResult = {
  project: DesktopProject;
  translation: DesktopTranslation;
};

type DesktopExportResult = {
  outputPath: string;
  mediaUrl: string;
  opened?: boolean;
};

type DesktopExportSubtitleTrack = "arabic" | "translation";
type DesktopExportSubtitleStyle = "black-band" | "outline";

type ExportProgress = {
  projectId: string;
  track: DesktopExportSubtitleTrack;
  stage: "render" | "done";
  message: string;
  percent?: number;
  eta?: string;
};

interface Window {
  tarjamaDesktop?: {
    readLibrary(): Promise<DesktopLibraryInfo>;
    loadProject(projectId: string): Promise<DesktopProjectLoad>;
    saveCurrentTranscript(projectId: string, transcript: DesktopTranscript): Promise<DesktopProjectLoad>;
    createTranscriptSnapshot(projectId: string, transcript: DesktopTranscript): Promise<DesktopProjectLoad>;
    loadSnapshot(projectId: string, snapshotId: string): Promise<{ snapshot: DesktopSnapshotInfo; transcript: DesktopTranscript }>;
    restoreSnapshot(projectId: string, snapshotId?: string): Promise<DesktopProjectLoad>;
    importTranscript(projectId: string): Promise<ImportTranscriptResult | null>;
    importTranslationFile(projectId: string): Promise<ImportTranslationResult | null>;
    importTranslationContent(
      projectId: string,
      content: string,
      filename: string,
      replace: boolean
    ): Promise<ImportTranslationResult>;
    saveTranslation(projectId: string, translation: DesktopTranslation): Promise<DesktopProjectLoad>;
    exportVideo(
      projectId: string,
      track: DesktopExportSubtitleTrack,
      openAfter?: boolean,
      style?: DesktopExportSubtitleStyle
    ): Promise<DesktopExportResult | null>;
    importLocalVideo(projectId?: string): Promise<DownloadYoutubeResult | null>;
    createYoutubeProject(request: CreateYoutubeProjectRequest): Promise<CreateYoutubeProjectResult>;
    listYoutubeFormats(url: string): Promise<YoutubeFormatsResult>;
    downloadYoutube(request: DownloadYoutubeRequest): Promise<DownloadYoutubeResult>;
    updateYtdlp(): Promise<UpdateToolResult>;
    onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void;
    onExportProgress(callback: (progress: ExportProgress) => void): () => void;
    setProjectArchived(projectId: string, archived: boolean): Promise<DesktopProject>;
    openProjectFolder(projectId: string): Promise<void>;
    trashProject(projectId: string): Promise<void>;
  };
}
