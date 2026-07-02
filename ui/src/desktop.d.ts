type DesktopProject = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  youtubeUrl?: string;
  youtubeId?: string;
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
  title?: string;
};

type DownloadYoutubeResult = {
  project: DesktopProject;
  videoPath: string;
};

type UpdateToolResult = {
  path: string;
  version: string;
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
};

interface Window {
  ashrafentDesktop?: {
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
    exportTranslatedVideo(projectId: string): Promise<DesktopExportResult | null>;
    importLocalVideo(): Promise<DownloadYoutubeResult | null>;
    downloadYoutube(request: DownloadYoutubeRequest): Promise<DownloadYoutubeResult>;
    updateYtdlp(): Promise<UpdateToolResult>;
    onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void;
    setProjectArchived(projectId: string, archived: boolean): Promise<DesktopProject>;
    openProjectFolder(projectId: string): Promise<void>;
    trashProject(projectId: string): Promise<void>;
  };
}
