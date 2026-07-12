export type DesktopProject = {
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
  groqTranscribedAt?: string;
  titleCustomizedAt?: string;
};

export type DesktopLibraryInfo = {
  libraryDir: string;
  projects: DesktopProject[];
};

export type TranscriptSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  translation: string;
};

export type WorkspaceTranscript = {
  corpus_id: string;
  audio_path?: string;
  source_transcript?: string;
  source_model?: string;
  project_instructions?: string;
  segments: TranscriptSegment[];
  created_at?: string;
  updated_at?: string;
};

export type ImportTranscriptResult = {
  project: DesktopProject;
  transcriptPath: string;
  segmentCount: number;
};

export type DownloadProgress = {
  projectId: string;
  stage: "metadata" | "download" | "mux" | "done";
  message: string;
  percent?: number;
  speed?: string;
  eta?: string;
};

export type ExportProgress = {
  projectId: string;
  track: ExportSubtitleTrack;
  stage: "render" | "done";
  message: string;
  percent?: number;
  eta?: string;
};

export type DownloadYoutubeRequest = {
  url: string;
  projectId?: string;
  title?: string;
  formatSelector?: string;
};

export type DownloadYoutubeResult = {
  project: DesktopProject;
  videoPath: string;
};

export type CreateYoutubeProjectRequest = {
  url: string;
  title?: string;
};

export type CreateYoutubeProjectResult = {
  project: DesktopProject;
  warning?: string;
};

export type CreateLocalProjectResult = {
  project: DesktopProject;
};

export type YoutubeFormatOption = {
  id: string;
  label: string;
  formatSelector: string;
  height?: number;
  fps?: number;
  ext?: string;
  filesizeApprox?: number;
  note?: string;
};

export type YoutubeFormatsResult = {
  title: string;
  duration?: number;
  webpageUrl?: string;
  formats: YoutubeFormatOption[];
};

export type UpdateToolResult = {
  path: string;
  version: string;
};

export type DesktopSnapshotInfo = {
  id: string;
  created_at?: string | null;
  segment_count: number;
  matches_current?: boolean;
};

export type DesktopRecoveryState = {
  needs_resolution: boolean;
  snapshot_path?: string | null;
  snapshot?: WorkspaceTranscript | null;
};

export type DesktopProjectLoad = {
  project: DesktopProject;
  mediaUrl?: string;
  transcript: WorkspaceTranscript | null;
  translation: WorkspaceTranslation | null;
  snapshots: DesktopSnapshotInfo[];
  recovery: DesktopRecoveryState;
};

export type WorkspaceTranslation = {
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

export type ImportTranslationResult = {
  project: DesktopProject;
  translation: WorkspaceTranslation;
};

export type DesktopExportResult = {
  outputPath: string;
  mediaUrl: string;
  opened?: boolean;
};

export type ExportSubtitleTrack = "arabic" | "translation";

export type ExportSubtitleStyle = "black-band" | "outline";

export type GroqKeyStatus = {
  configured: boolean;
  source: "stored" | "development-env" | "none";
};

export type GroqTranscriptionProgress = {
  projectId: string;
  stage: "preparing" | "uploading" | "merging" | "done";
  message: string;
  percent?: number;
  chunkIndex?: number;
  chunkCount?: number;
};

export type CleanedTranscriptImportResult = {
  loaded: DesktopProjectLoad;
  before: number;
  after: number;
  changed: number;
  added: number;
  removed: number;
};

export type PromptKind = "transcript_cleanup" | "translation";

export type DesktopPromptSettings = {
  transcriptCleanup: string;
  translation: string;
  transcriptCleanupCustomized: boolean;
  translationCustomized: boolean;
};
