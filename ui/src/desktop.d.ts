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

interface Window {
  ashrafentDesktop?: {
    readLibrary(): Promise<DesktopLibraryInfo>;
    importTranscript(projectId: string): Promise<ImportTranscriptResult | null>;
    downloadYoutube(request: DownloadYoutubeRequest): Promise<DownloadYoutubeResult>;
    openProjectFolder(projectId: string): Promise<void>;
    trashProject(projectId: string): Promise<void>;
  };
}
