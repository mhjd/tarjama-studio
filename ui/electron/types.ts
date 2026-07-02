export type DesktopProject = {
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

export type DownloadYoutubeRequest = {
  url: string;
  title?: string;
  formatSelector?: string;
};

export type DownloadYoutubeResult = {
  project: DesktopProject;
  videoPath: string;
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
};

export type ExportSubtitleTrack = "arabic" | "translation";
