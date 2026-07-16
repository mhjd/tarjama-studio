import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Check,
  CircleHelp,
  ClipboardPaste,
  Cloud,
  Combine,
  Copy,
  Download,
  ExternalLink,
  FileInput,
  GitCompare,
  History,
  LocateFixed,
  Moon,
  Pause,
  Pencil,
  Plus,
  Play,
  RotateCcw,
  Save,
  Search,
  Scissors,
  Settings,
  Square,
  Sun,
  Trash2,
  Upload,
  Undo2,
  X
} from "lucide-react";
import "./styles.css";
import {
  previewAlignedMarkdown,
  previewTranscriptJson,
  searchTranscript,
  transcriptFingerprint,
  validateEditorSegments,
  type ImportContentPreview,
} from "../electron/editor-logic";
import {
  AccessibleModal,
  ErrorNotice,
  formatElapsed,
  isTextEntryTarget,
  ModalCloseButton,
  OperationProgress,
} from "./desktop-ux";

type VideoItem = {
  corpus_id: string;
  title: string;
  speaker?: string;
  series?: string;
  episode?: number | null;
  duration_seconds?: number;
  audio_url?: string;
  has_video: boolean;
  has_workspace: boolean;
  has_autosave: boolean;
  has_snapshot: boolean;
  has_model_transcript: boolean;
};

type Segment = {
  id: string;
  start: number;
  end: number;
  text: string;
  translation: string;
};

type Transcript = {
  corpus_id: string;
  audio_path?: string;
  source_transcript?: string;
  source_model?: string;
  project_instructions?: string;
  segments: Segment[];
  updated_at?: string;
};

type RecoveryState = {
  needs_resolution: boolean;
  snapshot_path?: string | null;
  snapshot?: Transcript | null;
};

type TranscriptLoad = {
  transcript: Transcript;
  recovery: RecoveryState;
};

type DiffLine = {
  id: string;
  start: number;
  kind: "added" | "removed" | "changed";
  before: string;
  after: string;
};

type SnapshotInfo = {
  id: string;
  created_at?: string | null;
  segment_count: number;
  matches_current?: boolean;
};

type SnapshotLoad = {
  snapshot: SnapshotInfo;
  transcript: Transcript;
};

type Translation = {
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

type ExportTrack = "arabic" | "translation";
type ExportSubtitleStyle = "black-band" | "outline";
type ExportSubtitleSize = "compact" | "standard" | "large";
type ExportVideoQuality = "original" | "mobile-720p" | "compact-480p";
type ExportCueGrouping = "source" | "automatic" | "minimum-words";
type ExportVideoOptions = {
  style: ExportSubtitleStyle;
  subtitleSize: ExportSubtitleSize;
  videoQuality: ExportVideoQuality;
  cueGrouping: ExportCueGrouping;
  minimumWords?: number;
};
type DesktopView = "library" | "editor" | "options";
type DesktopActionMenu = "transcription" | "translation" | "export" | null;
type DesktopImportKind = "transcript" | "cleanup" | "translation";
type DesktopImportPreview = {
  projectId: string;
  kind: DesktopImportKind;
  filename: string;
  content: string;
  preview: ImportContentPreview;
};
type ResumePoint = { time: number; segmentId?: string };
type SaveStatus = "saved" | "dirty" | "saving";
const IMPORT_PREVIEW_CHARACTER_LIMIT = 20_000;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const DEFAULT_EXPORT_OPTIONS: ExportVideoOptions = {
  style: "black-band",
  subtitleSize: "standard",
  videoQuality: "mobile-720p",
  cueGrouping: "automatic",
};

function initialExportOptions(): ExportVideoOptions {
  try {
    const stored = JSON.parse(localStorage.getItem("tarjama-export-options") ?? "null") as Partial<ExportVideoOptions> | null;
    return {
      style: stored?.style === "outline" ? "outline" : "black-band",
      subtitleSize: ["compact", "standard", "large"].includes(stored?.subtitleSize ?? "")
        ? stored!.subtitleSize as ExportSubtitleSize
        : DEFAULT_EXPORT_OPTIONS.subtitleSize,
      videoQuality: ["original", "mobile-720p", "compact-480p"].includes(stored?.videoQuality ?? "")
        ? stored!.videoQuality as ExportVideoQuality
        : DEFAULT_EXPORT_OPTIONS.videoQuality,
      cueGrouping: ["source", "automatic", "minimum-words"].includes(stored?.cueGrouping ?? "")
        ? stored!.cueGrouping as ExportCueGrouping
        : DEFAULT_EXPORT_OPTIONS.cueGrouping,
      minimumWords: Math.max(2, Math.min(30, Number(stored?.minimumWords) || 10)),
    };
  } catch {
    return { ...DEFAULT_EXPORT_OPTIONS, minimumWords: 10 };
  }
}

type ExportJob = {
  id: string;
  corpus_id: string;
  track: ExportTrack;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  media_url?: string | null;
  error?: string | null;
};

const api = {
  async videos(): Promise<VideoItem[]> {
    const response = await fetch("/api/videos");
    if (!response.ok) throw new Error("Impossible de charger les vidéos");
    return (await response.json()).videos;
  },
  async ensureTranscript(corpusId: string): Promise<TranscriptLoad> {
    const response = await fetch(`/api/videos/${corpusId}/transcript/ensure`, { method: "POST" });
    if (!response.ok) throw new Error("Aucune transcription segmentée");
    return await response.json();
  },
  async saveCurrent(corpusId: string, transcript: Transcript): Promise<void> {
    const response = await fetch(`/api/videos/${corpusId}/transcript`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript })
    });
    if (!response.ok) throw new Error("Enregistrement impossible");
  },
  async createSnapshot(corpusId: string, transcript: Transcript): Promise<RecoveryState> {
    const response = await fetch(`/api/videos/${corpusId}/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript })
    });
    if (!response.ok) throw new Error("Sauvegarde impossible");
    return (await response.json()).recovery;
  },
  async snapshots(corpusId: string): Promise<SnapshotInfo[]> {
    const response = await fetch(`/api/videos/${corpusId}/snapshots`);
    if (!response.ok) throw new Error("Historique impossible à charger");
    return (await response.json()).snapshots;
  },
  async snapshot(corpusId: string, snapshotId: string): Promise<SnapshotLoad> {
    const response = await fetch(`/api/videos/${corpusId}/snapshots/${encodeURIComponent(snapshotId)}`);
    if (!response.ok) throw new Error(`Sauvegarde impossible à charger (${response.status})`);
    return await response.json();
  },
  async restoreSnapshot(corpusId: string, snapshotId?: string): Promise<TranscriptLoad> {
    const url = snapshotId
      ? `/api/videos/${corpusId}/snapshots/${encodeURIComponent(snapshotId)}/restore`
      : `/api/videos/${corpusId}/transcript/restore-snapshot`;
    const response = await fetch(url, { method: "POST" });
    if (!response.ok) throw new Error("Restauration impossible");
    return await response.json();
  },
  async translation(corpusId: string): Promise<Translation | null> {
    const response = await fetch(`/api/videos/${corpusId}/translation`);
    if (!response.ok) throw new Error("Traduction impossible à charger");
    return (await response.json()).translation;
  },
  async importTranslation(corpusId: string, content: string, filename: string, replace: boolean): Promise<Translation> {
    const response = await fetch(`/api/videos/${corpusId}/translation/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, filename, language: "fr", replace })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.detail ?? "Import de traduction impossible");
    }
    return (await response.json()).translation;
  },
  async saveTranslation(corpusId: string, translation: Translation): Promise<void> {
    const response = await fetch(`/api/videos/${corpusId}/translation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ translation })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.detail ?? "Enregistrement de traduction impossible");
    }
  },
  async createTranslationSnapshot(corpusId: string, translation: Translation): Promise<void> {
    const response = await fetch(`/api/videos/${corpusId}/translation/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ translation })
    });
    if (!response.ok) throw new Error("Sauvegarde de traduction impossible");
  },
  async createVideoExport(corpusId: string): Promise<ExportJob> {
    const response = await fetch(`/api/videos/${corpusId}/exports/video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track: "translation" satisfies ExportTrack })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.detail ?? "Export vidéo impossible");
    }
    return (await response.json()).job;
  },
  async exportJob(jobId: string): Promise<ExportJob> {
    const response = await fetch(`/api/exports/jobs/${jobId}`);
    if (!response.ok) throw new Error("Statut d'export impossible à charger");
    return (await response.json()).job;
  }
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatTimeMs(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00.000";
  const safe = Math.max(0, seconds);
  const totalMilliseconds = Math.round(safe * 1000);
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const base = hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${base}.${String(milliseconds).padStart(3, "0")}`;
}

function parseTime(value: string): number | null {
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function shortText(value: string, max = 140): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

function cleanupPastePreview(content: string): { valid: boolean; lines: string[] } {
  if (!content.trim()) return { valid: false, lines: [] };
  const markdownHeadings = [...content.matchAll(/^##\s+(.+?)\s+-->\s+(.+?)\s*$/gm)];
  if (markdownHeadings.length) {
    const first = markdownHeadings[0];
    const last = markdownHeadings.at(-1)!;
    return {
      valid: true,
      lines: [
        `Markdown horodaté: ${markdownHeadings.length} bloc(s)`,
        `Premier: ${first[1]} → ${first[2]}`,
        `Dernier: ${last[1]} → ${last[2]}`,
      ],
    };
  }
  try {
    const payload = JSON.parse(content) as { corpus_id?: unknown; segments?: unknown };
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.segments) || !payload.segments.length) {
      return { valid: false, lines: ["Le JSON doit contenir un tableau segments non vide."] };
    }
    const segments = payload.segments as Array<{ start?: unknown; end?: unknown; text?: unknown }>;
    const first = segments[0];
    const last = segments.at(-1)!;
    return {
      valid: true,
      lines: [
        "JSON détecté: ancien format encore accepté.",
        `corpus_id: ${String(payload.corpus_id ?? "absent")}`,
        `${segments.length} segment(s)`,
        `Premier: ${String(first.start ?? "?")} → ${String(first.end ?? "?")} · ${shortText(String(first.text ?? ""), 90)}`,
        `Dernier: ${String(last.start ?? "?")} → ${String(last.end ?? "?")} · ${shortText(String(last.text ?? ""), 90)}`,
      ],
    };
  } catch (error) {
    return { valid: false, lines: [`JSON invalide: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

function projectStatusLabel(project: DesktopProject): string {
  if (!project.videoPath) return "Vidéo absente";
  if (!project.transcriptPath) return "À transcrire";
  if (!project.translationPath) return "Transcription sans traduction";
  return "Prêt à exporter";
}

function snapshotLabel(snapshot: SnapshotInfo): string {
  if (!snapshot.created_at) return snapshot.id;
  const parsed = new Date(snapshot.created_at);
  if (Number.isNaN(parsed.getTime())) return snapshot.id;
  return `${parsed.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })} · ${snapshot.segment_count} seg.`;
}

function snapshotSortTime(snapshot: SnapshotInfo): number {
  if (!snapshot.created_at) return 0;
  const parsed = new Date(snapshot.created_at);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function segmentDiff(current: Transcript | null, snapshot: Transcript | null | undefined): DiffLine[] {
  if (!current || !snapshot) return [];
  const previous = new Map(snapshot.segments.map((segment) => [segment.id, segment]));
  const next = new Map(current.segments.map((segment) => [segment.id, segment]));
  const lines: DiffLine[] = [];

  current.segments.forEach((segment) => {
    const before = previous.get(segment.id);
    if (!before) {
      lines.push({ id: segment.id, start: segment.start, kind: "added", before: "", after: segment.text });
      return;
    }
    if (
      before.text !== segment.text ||
      before.translation !== segment.translation ||
      before.start !== segment.start ||
      before.end !== segment.end
    ) {
      lines.push({ id: segment.id, start: segment.start, kind: "changed", before: before.text, after: segment.text });
    }
  });

  snapshot.segments.forEach((segment) => {
    if (!next.has(segment.id)) {
      lines.push({ id: segment.id, start: segment.start, kind: "removed", before: segment.text, after: "" });
    }
  });

  return lines.sort((left, right) => left.start - right.start);
}

function applyTranslation(transcript: Transcript, translation: Translation | null): Transcript {
  if (!translation) return transcript;
  const translations = new Map(translation.segments.map((segment) => [segment.id, segment.translation]));
  return {
    ...transcript,
    segments: transcript.segments.map((segment) => ({
      ...segment,
      translation: translations.get(segment.id) ?? segment.translation ?? "",
    })),
  };
}

function translationFromTranscript(transcript: Transcript, base: Translation): Translation {
  return {
    ...base,
    corpus_id: transcript.corpus_id,
    segments: transcript.segments.map((segment) => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      translation: segment.translation ?? "",
    })),
  };
}

function transcriptWithoutTranslations(transcript: Transcript): Transcript {
  return {
    ...transcript,
    segments: transcript.segments.map((segment) => ({
      ...segment,
      translation: "",
    })),
  };
}

function translationPromptFromTranscript(transcript: Transcript): string {
  const projectInstructions = transcript.project_instructions?.trim();
  const sourceBlocks = transcript.segments
    .map((segment) => {
      const start = formatTimeMs(segment.start);
      const end = formatTimeMs(segment.end);
      return `## ${start} --> ${end}\n${segment.text.trim()}`;
    })
    .join("\n\n");

  return `Tu es traducteur professionnel arabe -> français.

Traduis la transcription arabe ci-dessous en français naturel, précis et strictement fidèle au sens.

Objectif de style:
- La traduction doit bien passer à l'oreille française, comme un sous-titre ou une traduction orale révisée.
- Ne fais pas de calque mot à mot quand l'expression arabe ou dialectale serait étrange en français.
- Reformule librement la syntaxe si nécessaire, mais ne change jamais l'idée, le niveau d'affirmation, ni l'intention du locuteur.
- Pour les expressions imagées, dialectales ou idiomatiques, traduis le sens pragmatique dans un français naturel.
- Garde un français sobre, clair et fluide; évite les tournures lourdes comme "la question de..., la question de..." si une reformulation naturelle est possible.

Exemple de reformulation attendue:
- Source: لا تجعلوا من الحبة قبة في هذه المسألة.
- Trop littéral: Ne faites pas d'un grain une coupole dans cette question.
- Mieux: N'exagérons pas l'importance de cette question.

Contraintes impératives:
- Réponds uniquement avec le document Markdown final, sans commentaire avant ou après.
- Conserve exactement les métadonnées source_corpus_id, language et format.
- Conserve exactement le même nombre de blocs.
- Conserve exactement chaque ligne de titre "## début --> fin", sans modifier les timestamps.
- Ne fusionne pas et ne divise pas les blocs.
- Sous chaque titre, remplace le texte arabe par la traduction française du bloc.
- Si un passage est ambigu, traduis au mieux sans ajouter de note.
${projectInstructions ? `\nInstructions propres à ce projet:\n${projectInstructions}\n` : ""}
Format de sortie attendu:

# Translation

source_corpus_id: ${transcript.corpus_id}
language: fr
format: tarjama-translation-v1

## 00:00.000 --> 00:03.440
Traduction française du bloc.

Transcription à traduire:

# Source

source_corpus_id: ${transcript.corpus_id}

${sourceBlocks}
`;
}

function DesktopApp() {
  const desktop = window.tarjamaDesktop;
  const [library, setLibrary] = useState<DesktopLibraryInfo | null>(null);
  const [desktopView, setDesktopView] = useState<DesktopView>("library");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [loadedProject, setLoadedProject] = useState<DesktopProject | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [attachedTranslation, setAttachedTranslation] = useState<Translation | null>(null);
  const [snapshots, setSnapshots] = useState<DesktopSnapshotInfo[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [previewTranscript, setPreviewTranscript] = useState<Transcript | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<DesktopSnapshotInfo | null>(null);
  const [showArchives, setShowArchives] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectMode, setNewProjectMode] = useState<"youtube" | "local">("youtube");
  const [newYoutubeUrl, setNewYoutubeUrl] = useState("");
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newYoutubeFormats, setNewYoutubeFormats] = useState<YoutubeFormatOption[]>([]);
  const [newSelectedYoutubeFormat, setNewSelectedYoutubeFormat] = useState("");
  const [newYoutubeTitle, setNewYoutubeTitle] = useState("");
  const [youtubeFormats, setYoutubeFormats] = useState<YoutubeFormatOption[]>([]);
  const [selectedYoutubeFormat, setSelectedYoutubeFormat] = useState("");
  const [youtubeFormatTitle, setYoutubeFormatTitle] = useState("");
  const [youtubeFormatProjectId, setYoutubeFormatProjectId] = useState("");
  const [state, setState] = useState("Prêt");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedProjectId, setCopiedProjectId] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [groqProgress, setGroqProgress] = useState<GroqTranscriptionProgress | null>(null);
  const [groqKeyStatus, setGroqKeyStatus] = useState<GroqKeyStatus>({ configured: false, source: "none" });
  const [groqApiKey, setGroqApiKey] = useState("");
  const [promptSettings, setPromptSettings] = useState<DesktopPromptSettings | null>(null);
  const [cleanupPromptDraft, setCleanupPromptDraft] = useState("");
  const [translationPromptDraft, setTranslationPromptDraft] = useState("");
  const [optionsState, setOptionsState] = useState("Prêt");
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("tarjama-theme") === "light" ? "light" : "dark"),
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rangeStart, setRangeStart] = useState("00:00");
  const [rangeEnd, setRangeEnd] = useState("00:00");
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [rangePlaybackActive, setRangePlaybackActive] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(() => {
    const stored = Number(localStorage.getItem("tarjama-playback-rate"));
    return PLAYBACK_RATES.includes(stored as (typeof PLAYBACK_RATES)[number]) ? stored : 1;
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pasteImportOpen, setPasteImportOpen] = useState(false);
  const [pastedTranslation, setPastedTranslation] = useState("");
  const [cleanupImportOpen, setCleanupImportOpen] = useState(false);
  const [pastedCleanupTranscript, setPastedCleanupTranscript] = useState("");
  const [cleanupCopyState, setCleanupCopyState] = useState("Copier le prompt de nettoyage");
  const [renameProjectOpen, setRenameProjectOpen] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [copyState, setCopyState] = useState("Copier prompt");
  const [exportingTrack, setExportingTrack] = useState<ExportTrack | null>(null);
  const [exportOptions, setExportOptions] = useState<ExportVideoOptions>(initialExportOptions);
  const [openActionMenu, setOpenActionMenu] = useState<DesktopActionMenu>(null);
  const [timelineHover, setTimelineHover] = useState<{ time: number; x: number } | null>(null);
  const [focusedSegmentId, setFocusedSegmentId] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [undoStack, setUndoStack] = useState<Transcript[]>([]);
  const [undoVisible, setUndoVisible] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [resumePoint, setResumePoint] = useState<ResumePoint | null>(null);
  const [importPreview, setImportPreview] = useState<DesktopImportPreview | null>(null);
  const [operationStartedAt, setOperationStartedAt] = useState<number | null>(null);
  const [operationClock, setOperationClock] = useState(Date.now());
  const [cancellingOperation, setCancellingOperation] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const resumeWriteSecond = useRef(-1);
  const lastActionRef = useRef<(() => Promise<void>) | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const segmentRefs = useRef(new Map<string, HTMLElement>());
  const segmentFieldRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const actionMenusRef = useRef<HTMLDivElement | null>(null);

  const activeProjects = useMemo(
    () => library?.projects.filter((project) => !project.archivedAt) ?? [],
    [library]
  );
  const archivedProjects = useMemo(
    () => library?.projects.filter((project) => project.archivedAt) ?? [],
    [library]
  );
  const loadedProjectHasVideo = Boolean(loadedProject?.videoPath);
  const isHistoryPreview = Boolean(previewTranscript);
  const displayedTranscript = previewTranscript ?? transcript;
  const editorLocked = isHistoryPreview || busy;
  const cleanedPasteReview = useMemo(
    () => cleanupPastePreview(pastedCleanupTranscript),
    [pastedCleanupTranscript],
  );
  const cleanupPromptChanged = Boolean(promptSettings && cleanupPromptDraft !== promptSettings.transcriptCleanup);
  const translationPromptChanged = Boolean(promptSettings && translationPromptDraft !== promptSettings.translation);
  const currentSaveSnapshot = useMemo(
    () => [...snapshots].reverse().find((snapshot) => snapshot.matches_current) ?? null,
    [snapshots]
  );
  const oldSnapshots = useMemo(
    () =>
      snapshots
        .filter((snapshot) => !snapshot.matches_current)
        .sort((left, right) => snapshotSortTime(right) - snapshotSortTime(left)),
    [snapshots]
  );
  const segmentIssues = useMemo(() => validateEditorSegments(displayedTranscript), [displayedTranscript]);
  const issuesBySegment = useMemo(() => {
    const grouped = new Map<string, string[]>();
    segmentIssues.forEach((issue) => grouped.set(issue.segmentId, [...(grouped.get(issue.segmentId) ?? []), issue.message]));
    return grouped;
  }, [segmentIssues]);
  const searchResults = useMemo(
    () => searchTranscript(displayedTranscript, searchQuery),
    [displayedTranscript, searchQuery],
  );
  const searchOccurrenceCount = searchResults.length;
  const activeSegmentId = useMemo(() => {
    const segments = displayedTranscript?.segments ?? [];
    return segments.find((segment) => currentTime >= segment.start && currentTime < segment.end)?.id ?? "";
  }, [currentTime, displayedTranscript]);
  const hasInterval = useMemo(() => {
    const start = parseTime(rangeStart) ?? 0;
    const end = parseTime(rangeEnd);
    return end !== null && end > start;
  }, [rangeEnd, rangeStart]);
  const playbackMode = loopEnabled && hasInterval ? "Boucle" : rangePlaybackActive && hasInterval ? "Intervalle" : "Lecture libre";
  const anyModalOpen = newProjectOpen || shortcutsOpen || pasteImportOpen || cleanupImportOpen || renameProjectOpen || Boolean(importPreview);

  const refreshLibrary = useCallback(async () => {
    if (!desktop) return;
    setLibrary(await desktop.readLibrary());
  }, [desktop]);

  const applyPromptSettings = useCallback((settings: DesktopPromptSettings) => {
    setPromptSettings(settings);
    setCleanupPromptDraft(settings.transcriptCleanup);
    setTranslationPromptDraft(settings.translation);
  }, []);

  const loadOptions = useCallback(async () => {
    if (!desktop) return;
    const [prompts, keyStatus] = await Promise.all([desktop.readPromptSettings(), desktop.groqKeyStatus()]);
    applyPromptSettings(prompts);
    setGroqKeyStatus(keyStatus);
  }, [applyPromptSettings, desktop]);

  useEffect(() => {
    void refreshLibrary().catch((err) => setError(err instanceof Error ? err.message : "Bibliothèque impossible à charger"));
  }, [refreshLibrary]);

  useEffect(() => {
    if (desktopView !== "options") return;
    void loadOptions().catch((err) => setError(err instanceof Error ? err.message : "Options impossibles à charger"));
  }, [desktopView, loadOptions]);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onDownloadProgress((progress) => {
      setDownloadProgress(progress);
      setState(progress.message);
    });
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onExportProgress((progress) => {
      if (selectedProjectId && progress.projectId !== selectedProjectId) return;
      setExportProgress(progress);
      setState(progress.message);
    });
  }, [desktop, selectedProjectId]);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onGroqTranscriptionProgress((progress) => {
      if (selectedProjectId && progress.projectId !== selectedProjectId) return;
      setGroqProgress(progress);
      setState(progress.message);
    });
  }, [desktop, selectedProjectId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("tarjama-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("tarjama-playback-rate", String(playbackRate));
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    localStorage.setItem("tarjama-export-options", JSON.stringify(exportOptions));
  }, [exportOptions]);

  useEffect(() => {
    if (!operationStartedAt) return;
    const timer = window.setInterval(() => setOperationClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [operationStartedAt]);

  useEffect(() => {
    if (searchOpen) window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [searchOpen]);

  useEffect(() => {
    if (saveStatus === "saving" || !transcript || !savedFingerprint) return;
    setSaveStatus(transcriptFingerprint(transcript) === savedFingerprint ? "saved" : "dirty");
  }, [savedFingerprint, saveStatus, transcript]);

  useEffect(() => {
    if (desktopView !== "editor") return;
    function onKeyDown(event: KeyboardEvent) {
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLocaleLowerCase();
      if (anyModalOpen) return;
      if (openActionMenu && event.key === "Escape") {
        event.preventDefault();
        setOpenActionMenu(null);
        return;
      }
      if (modifier && key === "s") {
        event.preventDefault();
        if (saveStatus === "dirty" && !editorLocked) void createSavePointDesktop();
        return;
      }
      if (modifier && key === "f") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (modifier && key === "z") {
        if (isTextEntryTarget(event.target)) return;
        event.preventDefault();
        undoLastStructuralEdit();
        return;
      }
      if (isTextEntryTarget(event.target) || event.metaKey || event.ctrlKey) return;
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        navigateAdjacentSegment(-1);
        return;
      }
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        navigateAdjacentSegment(1);
        return;
      }
      if (event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (searchOpen) setSearchOpen(false);
        else clearInterval();
        return;
      }
      if (!mediaUrl) return;
      const audio = audioRef.current;
      if (!audio) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekBy(event.shiftKey ? -10 : -3);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekBy(event.shiftKey ? 10 : 3);
      } else if (key === "d") {
        event.preventDefault();
        setRangeStart(formatTime(audio.currentTime));
      } else if (key === "f") {
        event.preventDefault();
        setRangeEnd(formatTime(audio.currentTime));
      } else if (key === "b") {
        event.preventDefault();
        setLoopEnabled((enabled) => !enabled);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        adjustPlaybackRate(-1);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        adjustPlaybackRate(1);
      } else if (key === "s") {
        event.preventDefault();
        scrollToCurrentSegment();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [anyModalOpen, desktopView, editorLocked, mediaUrl, openActionMenu, saveStatus, searchOpen, displayedTranscript, currentTime]);

  useEffect(() => {
    if (!openActionMenu) return;
    function onPointerDown(event: PointerEvent) {
      if (!actionMenusRef.current?.contains(event.target as Node)) {
        setOpenActionMenu(null);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openActionMenu]);

  const applyLoadedProject = useCallback((loaded: DesktopProjectLoad) => {
    setLoadedProject(loaded.project);
    setMediaUrl(loaded.mediaUrl ?? "");
    const nextTranscript = loaded.transcript ? applyTranslation(loaded.transcript, loaded.translation) : null;
    setTranscript(nextTranscript);
    setAttachedTranslation(loaded.translation);
    setSnapshots(loaded.snapshots);
    setSelectedSnapshotId("");
    setPreviewTranscript(null);
    setPreviewSnapshot(null);
    setUndoStack([]);
    setUndoVisible(false);
    const matchesSavedSnapshot = Boolean(loaded.transcript && loaded.snapshots.some((snapshot) => snapshot.matches_current));
    setSavedFingerprint(matchesSavedSnapshot ? transcriptFingerprint(nextTranscript) : "");
    setSaveStatus(loaded.transcript && !matchesSavedSnapshot ? "dirty" : "saved");
    const storedResume = localStorage.getItem(`tarjama-resume-${loaded.project.id}`);
    try {
      const parsed = storedResume ? JSON.parse(storedResume) as ResumePoint : null;
      setResumePoint(parsed && Number.isFinite(parsed.time) && parsed.time >= 5 ? parsed : null);
    } catch {
      setResumePoint(null);
    }
    setState(
      loaded.transcript
        ? loaded.translation
          ? "Transcription et traduction chargées"
          : "Transcription chargée"
        : "Vidéo sans transcription"
    );
  }, []);

  const loadDesktopProject = useCallback(
    async (projectId: string) => {
      if (!desktop || !projectId) return;
      setBusy(true);
      setError("");
      try {
        applyLoadedProject(await desktop.loadProject(projectId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Projet impossible à charger");
      } finally {
        setBusy(false);
      }
    },
    [applyLoadedProject, desktop]
  );

  useEffect(() => {
    if (!selectedProjectId) return;
    void loadDesktopProject(selectedProjectId);
  }, [loadDesktopProject, selectedProjectId]);

  useEffect(() => {
    if (!desktop || !selectedProjectId || !transcript || editorLocked) return;
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const plainTranscript = transcriptWithoutTranslations(transcript);
          const loaded = await desktop.saveCurrentTranscript(selectedProjectId, plainTranscript);
          if (attachedTranslation) {
            await desktop.saveTranslation(selectedProjectId, translationFromTranscript(transcript, attachedTranslation));
          }
          setLoadedProject(loaded.project);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Sauvegarde automatique impossible");
        }
      })();
    }, 900);
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, [attachedTranslation, desktop, editorLocked, selectedProjectId, transcript]);

  async function runDesktopAction(label: string, action: () => Promise<void>) {
    lastActionRef.current = async () => runDesktopAction(label, action);
    setBusy(true);
    setState(label);
    setError("");
    try {
      await action();
      await refreshLibrary();
      setState("Prêt");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action impossible";
      if (/annul|abort/i.test(message)) {
        setState("Opération annulée");
        setError("");
        setDownloadProgress(null);
        setGroqProgress(null);
      } else {
        setState("Erreur");
        setError(message);
      }
    } finally {
      setBusy(false);
      setCancellingOperation(false);
    }
  }

  async function importTranscriptDesktop(project: DesktopProject) {
    if (!project.videoPath) {
      setError("Ajoute d'abord une vidéo avant d'importer une transcription.");
      return;
    }
    await chooseImportFile("transcript", project.id);
  }

  async function transcribeGroqDesktop(project: DesktopProject) {
    if (!desktop || !project.videoPath) {
      setError("Ajoute d'abord une vidéo avant de lancer la transcription.");
      return;
    }
    if (project.groqTranscribedAt) {
      setError("Ce projet a déjà été transcrit avec Groq. La transcription reste disponible dans ce projet.");
      return;
    }
    const keyStatus = await desktop.groqKeyStatus();
    setGroqKeyStatus(keyStatus);
    if (!keyStatus.configured) {
      setDesktopView("options");
      setOptionsState("Ajoute une clé Groq avant de lancer la transcription.");
      return;
    }
    if (
      project.transcriptPath &&
      !window.confirm(
        attachedTranslation
          ? "Une transcription et une traduction existent déjà. Elles seront conservées dans l’historique, puis la traduction sera détachée car ses timestamps ne correspondront plus. Continuer ?"
          : "Une transcription existe déjà. Elle sera conservée dans l’historique puis remplacée par la sortie Groq. Continuer ?",
      )
    ) return;
    setGroqProgress({ projectId: project.id, stage: "preparing", percent: 0, message: "Préparation de la transcription Groq" });
    setOperationStartedAt(Date.now());
    setCancellingOperation(false);
    await runDesktopAction("Transcription Groq...", async () => {
      const loaded = await desktop.transcribeWithGroq(project.id);
      applyLoadedProject(loaded);
      setGroqProgress({ projectId: project.id, stage: "done", percent: 100, message: "Transcription Groq terminée" });
    });
    setOperationStartedAt(null);
  }

  async function saveGroqKeyDesktop() {
    if (!desktop || !groqApiKey.trim()) return;
    try {
      const status = await desktop.saveGroqApiKey(groqApiKey);
      setGroqKeyStatus(status);
      setGroqApiKey("");
      setOptionsState("Clé Groq enregistrée dans le coffre chiffré du système.");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clé Groq impossible à enregistrer");
    }
  }

  async function clearGroqKeyDesktop() {
    if (!desktop) return;
    if (!window.confirm("Supprimer la clé Groq personnelle enregistrée sur cet ordinateur ?")) return;
    try {
      setGroqKeyStatus(await desktop.clearGroqApiKey());
      setGroqApiKey("");
      setOptionsState("Clé Groq supprimée.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clé Groq impossible à supprimer");
    }
  }

  async function copyCleanupPromptDesktop() {
    if (!desktop || !selectedProjectId || !transcript) return;
    try {
      const saved = await desktop.saveCurrentTranscript(selectedProjectId, transcriptWithoutTranslations(transcript));
      if (!saved.transcript) throw new Error("La transcription courante n'a pas pu être enregistrée");
      const prompt = await desktop.cleanupTranscriptPrompt(selectedProjectId, saved.transcript);
      await navigator.clipboard.writeText(prompt);
      setCleanupCopyState("Prompt copié");
      setError("");
      window.setTimeout(() => setCleanupCopyState("Copier le prompt de nettoyage"), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copie du prompt impossible");
    }
  }

  function applyCleanedTranscriptResult(result: CleanedTranscriptImportResult) {
    applyLoadedProject(result.loaded);
    setState(
      `Nettoyage importé: ${result.changed} modifié(s), ${result.added} ajouté(s), ${result.removed} supprimé(s)`,
    );
  }

  async function importCleanedTranscriptFileDesktop() {
    await chooseImportFile("cleanup");
  }

  function buildImportPreview(projectId: string, kind: DesktopImportKind, filename: string, content: string): DesktopImportPreview {
    if (kind === "transcript") {
      return { projectId, kind, filename, content, preview: previewTranscriptJson(content) };
    }
    if (!transcript) {
      return {
        projectId,
        kind,
        filename,
        content,
        preview: { valid: false, segmentCount: 0, alignedCount: 0, errors: ["Aucune transcription source dans ce projet"] },
      };
    }
    if (kind === "cleanup") {
      const review = cleanupPastePreview(content);
      const segmentCount = (content.match(/^##\s+/gm) ?? []).length;
      return {
        projectId,
        kind,
        filename,
        content,
        preview: {
          valid: review.valid,
          segmentCount,
          alignedCount: 0,
          errors: review.valid ? [] : review.lines,
        },
      };
    }
    return { projectId, kind, filename, content, preview: previewAlignedMarkdown(content, transcriptWithoutTranslations(transcript)) };
  }

  async function chooseImportFile(kind: DesktopImportKind, projectId = selectedProjectId) {
    if (!desktop) return;
    setError("");
    try {
      const selection = await desktop.pickTextImport(kind);
      if (selection) setImportPreview(buildImportPreview(projectId, kind, selection.filename, selection.content));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fichier impossible à lire");
    }
  }

  function previewPastedImport(kind: "cleanup" | "translation", content: string) {
    if (!content.trim()) return;
    if (kind === "cleanup") setCleanupImportOpen(false);
    else setPasteImportOpen(false);
    setImportPreview(buildImportPreview(selectedProjectId, kind, kind === "cleanup" ? "contenu-collé.md" : "traduction-collée.md", content));
  }

  async function confirmImportPreview() {
    if (!desktop || !importPreview?.projectId || !importPreview.preview.valid) return;
    setBusy(true);
    setError("");
    try {
      if (importPreview.kind === "transcript") {
        const result = await desktop.importTranscriptContent(importPreview.projectId, importPreview.content, importPreview.filename);
        setState(`Transcription importée: ${result.segmentCount} segments`);
        setSelectedProjectId(importPreview.projectId);
        setDesktopView("editor");
        await loadDesktopProject(importPreview.projectId);
      } else if (importPreview.kind === "cleanup") {
        applyCleanedTranscriptResult(await desktop.importCleanedTranscriptContent(importPreview.projectId, importPreview.content));
        setPastedCleanupTranscript("");
        setCleanupImportOpen(false);
      } else {
        const result = await desktop.importTranslationContent(
          importPreview.projectId,
          importPreview.content,
          importPreview.filename,
          true,
        );
        setAttachedTranslation(result.translation);
        if (transcript) setTranscript(applyTranslation(transcript, result.translation));
        setPastedTranslation("");
        setPasteImportOpen(false);
        await loadDesktopProject(importPreview.projectId);
      }
      setImportPreview(null);
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import impossible");
    } finally {
      setBusy(false);
    }
  }

  async function savePromptDesktop(kind: DesktopPromptKind) {
    if (!desktop) return;
    const content = kind === "transcript_cleanup" ? cleanupPromptDraft : translationPromptDraft;
    setOptionsState("Enregistrement du prompt...");
    setError("");
    try {
      const settings = await desktop.savePrompt(kind, content);
      setPromptSettings(settings);
      if (kind === "transcript_cleanup") setCleanupPromptDraft(settings.transcriptCleanup);
      else setTranslationPromptDraft(settings.translation);
      setOptionsState("Prompt personnalisé enregistré.");
    } catch (err) {
      setOptionsState("Erreur");
      setError(err instanceof Error ? err.message : "Prompt impossible à enregistrer");
    }
  }

  async function resetPromptDesktop(kind: DesktopPromptKind) {
    if (!desktop) return;
    const label = kind === "transcript_cleanup" ? "correction de transcription" : "traduction";
    if (!window.confirm(`Êtes-vous sûr de vouloir revenir au prompt par défaut de ${label} ? Le prompt personnalisé sera supprimé et cette suppression ne pourra pas être annulée.`)) return;
    setOptionsState("Restauration du prompt par défaut...");
    setError("");
    try {
      const settings = await desktop.resetPrompt(kind);
      setPromptSettings(settings);
      if (kind === "transcript_cleanup") setCleanupPromptDraft(settings.transcriptCleanup);
      else setTranslationPromptDraft(settings.translation);
      setOptionsState("Prompt par défaut restauré.");
    } catch (err) {
      setOptionsState("Erreur");
      setError(err instanceof Error ? err.message : "Prompt par défaut impossible à restaurer");
    }
  }

  function openDesktopProject(projectId: string) {
    setYoutubeFormats([]);
    setSelectedYoutubeFormat("");
    setYoutubeFormatTitle("");
    setYoutubeFormatProjectId("");
    setSelectedProjectId(projectId);
    setDesktopView("editor");
    window.scrollTo({ top: 0 });
  }

  async function persistCurrentState() {
    if (!desktop || !selectedProjectId || !transcript || editorLocked) return;
    const loaded = await desktop.saveCurrentTranscript(selectedProjectId, transcriptWithoutTranslations(transcript));
    if (attachedTranslation) {
      await desktop.saveTranslation(selectedProjectId, translationFromTranscript(transcript, attachedTranslation));
    }
    setLoadedProject(loaded.project);
  }

  async function returnToLibrary() {
    if (
      desktopView === "options" &&
      (cleanupPromptChanged || translationPromptChanged) &&
      !window.confirm("Des modifications de prompt ne sont pas enregistrées. Quitter Options et les abandonner ?")
    ) return;
    audioRef.current?.pause();
    try {
      await persistCurrentState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Modifications courantes impossibles à conserver");
      return;
    }
    setDesktopView("library");
    setPreviewTranscript(null);
    setPreviewSnapshot(null);
    setSelectedSnapshotId("");
    window.scrollTo({ top: 0 });
  }

  function resetNewProject() {
    setNewProjectMode("youtube");
    setNewYoutubeUrl("");
    setNewProjectTitle("");
    setNewYoutubeFormats([]);
    setNewSelectedYoutubeFormat("");
    setNewYoutubeTitle("");
  }

  function openNewProject(mode: "youtube" | "local" = "youtube") {
    setError("");
    resetNewProject();
    setNewProjectMode(mode);
    setNewProjectOpen(true);
  }

  function closeNewProject() {
    if (busy) return;
    setNewProjectOpen(false);
    resetNewProject();
    setError("");
  }

  async function analyzeNewYoutubeProject() {
    const url = newYoutubeUrl.trim();
    if (!desktop || !url) {
      setError("Colle un lien YouTube avant de l’analyser.");
      return;
    }
    setBusy(true);
    setState("Analyse de la vidéo YouTube...");
    setError("");
    try {
      const result = await desktop.listYoutubeFormats(url);
      setNewYoutubeFormats(result.formats);
      setNewSelectedYoutubeFormat(result.formats[0]?.formatSelector ?? "");
      setNewYoutubeTitle(result.title);
      setState(`${result.formats.length} format(s) disponible(s)`);
    } catch (err) {
      setState("Erreur");
      setError(err instanceof Error ? err.message : "Analyse de la vidéo impossible");
    } finally {
      setBusy(false);
    }
  }

  async function downloadNewYoutubeProject() {
    const url = newYoutubeUrl.trim();
    if (!desktop || !url || !newSelectedYoutubeFormat) return;
    setOperationStartedAt(Date.now());
    setCancellingOperation(false);
    await runDesktopAction("Téléchargement vidéo...", async () => {
      setDownloadProgress({ projectId: "pending", stage: "metadata", message: "Préparation du projet YouTube..." });
      const result = await desktop.downloadYoutube({ url, formatSelector: newSelectedYoutubeFormat });
      setSelectedProjectId(result.project.id);
      setDesktopView("editor");
      applyLoadedProject(await desktop.loadProject(result.project.id));
      setDownloadProgress({ projectId: result.project.id, stage: "done", percent: 100, message: "Téléchargement terminé" });
      setNewProjectOpen(false);
      resetNewProject();
    });
    setOperationStartedAt(null);
  }

  async function importNewLocalProjectVideo() {
    const title = newProjectTitle.trim();
    if (!desktop || !title) {
      setError("Donne un titre au projet avant de choisir la vidéo.");
      return;
    }
    await runDesktopAction("Choix de la vidéo...", async () => {
      const result = await desktop.importLocalVideo(undefined, title);
      if (!result) return;
      setSelectedProjectId(result.project.id);
      setDesktopView("editor");
      applyLoadedProject(await desktop.loadProject(result.project.id));
      setNewProjectOpen(false);
      resetNewProject();
    });
  }

  async function createNewLocalProjectWithoutVideo() {
    const title = newProjectTitle.trim();
    if (!desktop || !title) {
      setError("Donne un titre au projet avant de le créer.");
      return;
    }
    await runDesktopAction("Création du projet...", async () => {
      const result = await desktop.createLocalProject(title);
      setSelectedProjectId(result.project.id);
      setDesktopView("editor");
      applyLoadedProject(await desktop.loadProject(result.project.id));
      setNewProjectOpen(false);
      resetNewProject();
    });
  }

  async function downloadYoutubeDesktop(project: DesktopProject) {
    const url = project.youtubeUrl?.trim() ?? "";
    if (!url) {
      setError("Ce projet n'a pas de lien YouTube.");
      return;
    }
    if (
      project.videoPath &&
      !window.confirm("Remplacer la vidéo actuelle par la qualité YouTube sélectionnée ? La transcription et la traduction seront conservées.")
    ) return;
    setOperationStartedAt(Date.now());
    setCancellingOperation(false);
    await runDesktopAction("Téléchargement vidéo...", async () => {
      setDownloadProgress({ projectId: project.id, stage: "metadata", message: "Analyse de la vidéo YouTube..." });
      const result = await desktop?.downloadYoutube({
        url,
        projectId: project.id,
        formatSelector: selectedYoutubeFormat || undefined,
      });
      setYoutubeFormats([]);
      setSelectedYoutubeFormat("");
      setYoutubeFormatTitle("");
      setYoutubeFormatProjectId("");
      if (result) {
        applyLoadedProject(await desktop!.loadProject(result.project.id));
        setDownloadProgress({ projectId: result.project.id, stage: "done", percent: 100, message: "Téléchargement terminé" });
      }
    });
    setOperationStartedAt(null);
  }

  async function analyzeYoutubeFormatsDesktop(project: DesktopProject) {
    const url = project.youtubeUrl?.trim() ?? "";
    if (!url) {
      setError("Ce projet n'a pas de lien YouTube.");
      return;
    }
    await runDesktopAction("Analyse des formats...", async () => {
      const result = await desktop?.listYoutubeFormats(url);
      if (!result) return;
      setYoutubeFormats(result.formats);
      setSelectedYoutubeFormat(result.formats[0]?.formatSelector ?? "");
      setYoutubeFormatTitle(result.title);
      setYoutubeFormatProjectId(project.id);
      setState(`${result.formats.length} format(s) disponible(s)`);
    });
  }

  async function importLocalVideoDesktop(project?: DesktopProject) {
    if (
      project?.videoPath &&
      !window.confirm("Remplacer la vidéo actuelle par un fichier local ? La transcription et la traduction seront conservées.")
    ) return;
    await runDesktopAction("Import vidéo...", async () => {
      const result = await desktop?.importLocalVideo(project?.id);
      if (result) {
        setSelectedProjectId(result.project.id);
        setDesktopView("editor");
        if (project) applyLoadedProject(await desktop!.loadProject(result.project.id));
        setState("Vidéo importée. Tu peux maintenant importer une transcription.");
        setDownloadProgress(null);
      }
    });
  }

  async function updateYtdlpDesktop() {
    setOptionsState("Mise à jour de yt-dlp...");
    await runDesktopAction("Mise à jour yt-dlp...", async () => {
      const result = await desktop?.updateYtdlp();
      if (result) {
        setState(`yt-dlp mis à jour: ${result.version}`);
        setOptionsState(`yt-dlp mis à jour: ${result.version}`);
      }
    });
  }

  async function archiveProjectDesktop(project: DesktopProject, archived: boolean) {
    await runDesktopAction(archived ? "Archivage..." : "Désarchivage...", async () => {
      await desktop?.setProjectArchived(project.id, archived);
      if (selectedProjectId === project.id && archived) {
        setSelectedProjectId("");
        setDesktopView("library");
        setLoadedProject(null);
        setTranscript(null);
        setAttachedTranslation(null);
      }
    });
  }

  async function copyProjectYoutubeUrl(project: DesktopProject) {
    if (!project.youtubeUrl) return;
    try {
      await navigator.clipboard.writeText(project.youtubeUrl);
      setCopiedProjectId(project.id);
      setError("");
      window.setTimeout(() => {
        setCopiedProjectId((current) => (current === project.id ? "" : current));
      }, 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copie du lien impossible");
    }
  }

  async function trashProjectDesktop(project: DesktopProject) {
    await runDesktopAction("Suppression...", async () => {
      await desktop?.trashProject(project.id);
    });
  }

  function openRenameProject() {
    if (!loadedProject) return;
    setProjectTitleDraft(loadedProject.title);
    setRenameProjectOpen(true);
  }

  async function renameProjectDesktop() {
    if (!desktop || !loadedProject || !projectTitleDraft.trim()) return;
    setBusy(true);
    setError("");
    try {
      const updated = await desktop.renameProject(loadedProject.id, projectTitleDraft);
      setLoadedProject(updated);
      setRenameProjectOpen(false);
      setState("Projet renommé");
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Projet impossible à renommer");
    } finally {
      setBusy(false);
    }
  }

  function isInsidePlaybackRange(seconds: number) {
    const start = parseTime(rangeStart) ?? 0;
    const end = parseTime(rangeEnd);
    return end !== null && end > start && seconds >= start && seconds < end;
  }

  function seekTo(seconds: number, preserveRangePlayback = false) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(seconds, duration || seconds));
    setCurrentTime(audio.currentTime);
    if (!preserveRangePlayback && !isInsidePlaybackRange(audio.currentTime)) {
      setRangePlaybackActive(false);
    }
  }

  function seekBy(delta: number) {
    seekTo((audioRef.current?.currentTime ?? 0) + delta);
  }

  function adjustPlaybackRate(direction: -1 | 1) {
    setPlaybackRate((rate) => {
      const currentIndex = PLAYBACK_RATES.indexOf(rate as (typeof PLAYBACK_RATES)[number]);
      const nextIndex = Math.max(0, Math.min(PLAYBACK_RATES.length - 1, currentIndex + direction));
      return PLAYBACK_RATES[nextIndex];
    });
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
    const start = parseTime(rangeStart) ?? 0;
    const end = parseTime(rangeEnd);
    const hasRange = end !== null && end > start;
    if (audio.paused && rangePlaybackActive && hasRange && audio.currentTime >= end - 0.05) {
      audio.currentTime = start;
      setCurrentTime(start);
    }
    if (audio.paused) {
      setRangePlaybackActive(hasRange && (rangePlaybackActive || isInsidePlaybackRange(audio.currentTime)));
      void audio.play();
    } else {
      audio.pause();
    }
  }

  function returnToInterval() {
    const start = parseTime(rangeStart) ?? 0;
    seekTo(start, true);
    setRangePlaybackActive(true);
  }

  function clearInterval() {
    setRangeStart("00:00");
    setRangeEnd("00:00");
    setLoopEnabled(false);
    setRangePlaybackActive(false);
  }

  function onTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = audio.currentTime;
    setCurrentTime(nextTime);
    const wholeSecond = Math.floor(nextTime);
    if (selectedProjectId && wholeSecond % 2 === 0 && wholeSecond !== resumeWriteSecond.current) {
      resumeWriteSecond.current = wholeSecond;
      const active = transcript?.segments.find((segment) => nextTime >= segment.start && nextTime < segment.end);
      localStorage.setItem(
        `tarjama-resume-${selectedProjectId}`,
        JSON.stringify({ time: nextTime, segmentId: active?.id }),
      );
    }
    const end = parseTime(rangeEnd);
    const start = parseTime(rangeStart) ?? 0;
    if (rangePlaybackActive && loopEnabled && end !== null && end > start && nextTime >= end) {
      audio.currentTime = start;
      void audio.play();
      return;
    }
    if (rangePlaybackActive && !loopEnabled && end !== null && end > start && nextTime >= end) {
      audio.pause();
      audio.currentTime = end;
      setCurrentTime(end);
    }
  }

  function updateDesktopTimelineHover(event: React.PointerEvent<HTMLDivElement>) {
    const max = duration || loadedProject?.durationSeconds || 0;
    if (!max) {
      setTimelineHover(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setTimelineHover({ time: ratio * max, x: ratio * 100 });
  }

  function scrollToCurrentSegment() {
    const segments = displayedTranscript?.segments;
    if (!segments?.length) return;
    const time = audioRef.current?.currentTime ?? currentTime;
    const target =
      segments.find((segment) => time >= segment.start && time < segment.end) ??
      [...segments].reverse().find((segment) => segment.start <= time) ??
      segments[0];
    const element = segmentRefs.current.get(target.id);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    setFocusedSegmentId(target.id);
    window.setTimeout(() => {
      setFocusedSegmentId((current) => (current === target.id ? "" : current));
    }, 1600);
  }

  function focusSegment(segmentId: string, seek = true) {
    const segment = displayedTranscript?.segments.find((candidate) => candidate.id === segmentId);
    if (!segment) return;
    if (seek) seekTo(segment.start);
    setFocusedSegmentId(segment.id);
    segmentRefs.current.get(segment.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function navigateAdjacentSegment(direction: -1 | 1) {
    const segments = displayedTranscript?.segments ?? [];
    if (!segments.length) return;
    const anchorId = focusedSegmentId || activeSegmentId;
    const currentIndex = Math.max(0, segments.findIndex((segment) => segment.id === anchorId));
    const nextIndex = Math.max(0, Math.min(segments.length - 1, currentIndex + direction));
    focusSegment(segments[nextIndex].id);
  }

  function navigateSearch(direction: -1 | 1) {
    if (!searchResults.length) return;
    const nextIndex = (searchIndex + direction + searchResults.length) % searchResults.length;
    setSearchIndex(nextIndex);
    const result = searchResults[nextIndex];
    focusSegment(result.segmentId, false);
    window.setTimeout(() => {
      const field = segmentFieldRefs.current.get(`${result.segmentId}:${result.field}`);
      if (!field) return;
      field.focus();
      field.setSelectionRange(result.offset, result.offset + searchQuery.trim().length);
    }, 250);
  }

  function acceptResumePoint() {
    if (!resumePoint) return;
    seekTo(resumePoint.time);
    if (resumePoint.segmentId) focusSegment(resumePoint.segmentId, false);
    setResumePoint(null);
  }

  function restartProjectPlayback() {
    seekTo(0);
    setResumePoint(null);
    if (selectedProjectId) localStorage.setItem(`tarjama-resume-${selectedProjectId}`, JSON.stringify({ time: 0 }));
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateSegment(id: string, patch: Partial<Segment>) {
    if (!transcript || editorLocked) return;
    setTranscript({
      ...transcript,
      segments: transcript.segments.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)),
    });
    setSaveStatus("dirty");
  }

  function mutateSegments(mutator: (segments: Segment[]) => Segment[]) {
    if (!transcript || editorLocked) return;
    const nextSegments = mutator(transcript.segments);
    if (nextSegments === transcript.segments) return;
    setUndoStack((stack) => [...stack.slice(-19), structuredClone(transcript)]);
    setTranscript({ ...transcript, segments: nextSegments });
    setSaveStatus("dirty");
    setUndoVisible(true);
    window.setTimeout(() => setUndoVisible(false), 5000);
  }

  function undoLastStructuralEdit() {
    if (!undoStack.length || editorLocked) return;
    const previous = undoStack.at(-1)!;
    setUndoStack((stack) => stack.slice(0, -1));
    setTranscript(previous);
    setSaveStatus("dirty");
    setUndoVisible(false);
  }

  function addSegmentAfter(segmentId: string) {
    mutateSegments((segments) => {
      const index = segments.findIndex((segment) => segment.id === segmentId);
      if (index < 0) return segments;
      const current = segments[index];
      const next = segments[index + 1];
      return [
        ...segments.slice(0, index + 1),
        {
          id: `seg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          start: current.end,
          end: next ? Math.max(current.end, next.start) : current.end + 2,
          text: "",
          translation: "",
        },
        ...segments.slice(index + 1),
      ];
    });
  }

  function deleteSegment(segmentId: string) {
    mutateSegments((segments) => segments.filter((segment) => segment.id !== segmentId));
  }

  function splitSegment(segmentId: string) {
    mutateSegments((segments) => {
      const index = segments.findIndex((segment) => segment.id === segmentId);
      if (index < 0) return segments;
      const current = segments[index];
      if (currentTime <= current.start || currentTime >= current.end) return segments;
      return [
        ...segments.slice(0, index),
        { ...current, end: currentTime },
        {
          ...current,
          id: `seg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          start: currentTime,
          translation: "",
        },
        ...segments.slice(index + 1),
      ];
    });
  }

  function mergeWithNext(segmentId: string) {
    mutateSegments((segments) => {
      const index = segments.findIndex((segment) => segment.id === segmentId);
      if (index < 0 || index >= segments.length - 1) return segments;
      const current = segments[index];
      const next = segments[index + 1];
      return [
        ...segments.slice(0, index),
        {
          ...current,
          end: next.end,
          text: [current.text, next.text].filter(Boolean).join(" ").trim(),
          translation: [current.translation, next.translation].filter(Boolean).join("\n").trim(),
        },
        ...segments.slice(index + 2),
      ];
    });
  }

  async function createSavePointDesktop() {
    if (!desktop || !selectedProjectId || !transcript || editorLocked || saveStatus !== "dirty") return;
    if (segmentIssues.length) {
      setError("Corrige les erreurs d’horodatage signalées avant de sauvegarder.");
      focusSegment(segmentIssues[0].segmentId, false);
      return;
    }
    setSaveStatus("saving");
    setError("");
    try {
      applyLoadedProject(await desktop.createTranscriptSnapshot(selectedProjectId, transcript));
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("dirty");
      setError(err instanceof Error ? err.message : "Sauvegarde impossible");
    }
  }

  async function copyTranslationPromptDesktop() {
    if (!desktop || !selectedProjectId || !transcript) return;
    try {
      const prompt = await desktop.translationPrompt(selectedProjectId, transcriptWithoutTranslations(transcript));
      await navigator.clipboard.writeText(prompt);
      setCopyState("Copié");
      window.setTimeout(() => setCopyState("Copier prompt"), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copie impossible");
    }
  }

  async function importTranslationFileDesktop() {
    if (!desktop || !selectedProjectId) return;
    if (!loadedProjectHasVideo) {
      setError("Ajoute d'abord une vidéo avant d'importer une traduction.");
      return;
    }
    await chooseImportFile("translation");
  }

  async function importPastedTranslationDesktop() {
    if (!desktop || !selectedProjectId || !pastedTranslation.trim()) return;
    if (!loadedProjectHasVideo) {
      setError("Ajoute d'abord une vidéo avant d'importer une traduction.");
      return;
    }
    previewPastedImport("translation", pastedTranslation);
  }

  async function exportVideoDesktop(track: ExportTrack, openAfter = false) {
    if (!desktop || !selectedProjectId || !transcript) {
      setError("Importe une transcription avant d'exporter.");
      return;
    }
    if (track === "translation" && !attachedTranslation) {
      setError("Importe une traduction avant d'exporter la traduction.");
      return;
    }
    if (!loadedProjectHasVideo) {
      setError("Ajoute d'abord une vidéo avant d'exporter.");
      return;
    }
    setExportingTrack(track);
    setOperationStartedAt(Date.now());
    setCancellingOperation(false);
    setExportProgress(null);
    setError("");
    setState(track === "arabic" ? "Préparation de l'export arabe..." : "Préparation de l'export traduction...");
    try {
      await desktop.saveCurrentTranscript(selectedProjectId, transcriptWithoutTranslations(transcript));
      if (attachedTranslation) {
        await desktop.saveTranslation(selectedProjectId, translationFromTranscript(transcript, attachedTranslation));
      }
      setState("Choisis l'emplacement du fichier exporté...");
      const result = await desktop.exportVideo(selectedProjectId, track, openAfter, exportOptions);
      if (result) {
        setState(result.opened ? `Export créé et ouvert: ${result.outputPath}` : `Export créé: ${result.outputPath}`);
        setExportProgress(null);
      } else {
        setState("Export annulé.");
        setExportProgress(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export impossible";
      if (/annul|abort/i.test(message)) {
        setState("Export annulé.");
        setError("");
      } else {
        setState("Export échoué.");
        setError(message);
      }
      setExportProgress(null);
    } finally {
      setExportingTrack(null);
      setOperationStartedAt(null);
      setCancellingOperation(false);
    }
  }

  async function cancelLongOperation(kind: LongOperationKind) {
    if (!desktop) return;
    setCancellingOperation(true);
    const cancelled = await desktop.cancelOperation(kind);
    if (!cancelled) setCancellingOperation(false);
    else setState("Annulation en cours...");
  }

  async function selectDesktopSnapshot(snapshotId: string) {
    setSelectedSnapshotId(snapshotId);
    if (!desktop || !selectedProjectId || !snapshotId) {
      setPreviewSnapshot(null);
      setPreviewTranscript(null);
      return;
    }
    try {
      const loaded = await desktop.loadSnapshot(selectedProjectId, snapshotId);
      setPreviewSnapshot(loaded.snapshot);
      setPreviewTranscript(loaded.transcript);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sauvegarde impossible à charger");
    }
  }

  async function restoreDesktopSnapshot() {
    if (!desktop || !selectedProjectId || !previewSnapshot) return;
    const confirmed = window.confirm("Restaurer cette ancienne sauvegarde à la place de la version courante ?");
    if (!confirmed) return;
    try {
      applyLoadedProject(await desktop.restoreSnapshot(selectedProjectId, previewSnapshot.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restauration impossible");
    }
  }

  function renderProject(project: DesktopProject) {
    const selected = selectedProjectId === project.id;
    return (
      <article className={`desktop-project ${selected ? "selected" : ""}`} key={project.id}>
        <div className="desktop-project-main">
          <button className="project-picker" onClick={() => openDesktopProject(project.id)}>
            <strong dir="auto">{project.title}</strong>
            <small>
              {project.videoPath ? "Vidéo" : "Vidéo absente"} ·{" "}
              {project.transcriptPath ? "Transcription" : "À transcrire"} ·{" "}
              {project.translationPath ? "Traduction" : "Sans traduction"}
            </small>
          </button>
          <div className="project-link-row">
            <span>{project.youtubeUrl || project.id}</span>
            <button disabled={busy || !project.youtubeUrl} onClick={() => void copyProjectYoutubeUrl(project)}>
              <Copy size={16} />
              <span>{copiedProjectId === project.id ? "Copié" : "Copier"}</span>
            </button>
          </div>
        </div>
        <div className="desktop-project-actions">
          <button
            disabled={busy || !project.videoPath}
            title={!project.videoPath ? "Ajoute d’abord une vidéo" : project.transcriptPath ? "Remplacer la transcription du projet" : "Importer une transcription"}
            onClick={() => void importTranscriptDesktop(project)}
          >
            <Upload size={16} />
            <span>{project.transcriptPath ? "Remplacer transcription" : "Importer transcription"}</span>
          </button>
          <button disabled={busy} onClick={() => void archiveProjectDesktop(project, !project.archivedAt)}>
            <History size={16} />
            <span>{project.archivedAt ? "Désarchiver" : "Archiver"}</span>
          </button>
          <button disabled={busy} onClick={() => void desktop?.openProjectFolder(project.id)}>
            <FileInput size={16} />
            <span>Dossier</span>
          </button>
          <button disabled={busy} onClick={() => void trashProjectDesktop(project)}>
            <Trash2 size={16} />
            <span>Corbeille</span>
          </button>
        </div>
      </article>
    );
  }

  function renderDownloadProgress() {
    if (!downloadProgress || downloadProgress.stage === "done") return null;
    return (
      <OperationProgress
        message={downloadProgress.message}
        percent={downloadProgress.percent}
        detail={[downloadProgress.speed, downloadProgress.eta ? `Reste ${downloadProgress.eta}` : ""].filter(Boolean).join(" · ")}
        elapsed={formatElapsed(operationStartedAt ? operationClock - operationStartedAt : 0)}
        cancelling={cancellingOperation}
        onCancel={() => void cancelLongOperation("download")}
      />
    );
  }

  function renderExportProgress() {
    if (!exportProgress || exportProgress.stage === "done") return null;
    return (
      <OperationProgress
        message={exportProgress.message}
        percent={exportProgress.percent}
        detail={exportProgress.eta ? `Reste ${exportProgress.eta}` : "Rendu en cours"}
        elapsed={formatElapsed(operationStartedAt ? operationClock - operationStartedAt : 0)}
        cancelling={cancellingOperation}
        onCancel={() => void cancelLongOperation("export")}
      />
    );
  }

  function renderGroqProgress() {
    if (!groqProgress || groqProgress.stage === "done") return null;
    return (
      <OperationProgress
        message={groqProgress.message}
        percent={groqProgress.percent}
        detail={groqProgress.chunkIndex && groqProgress.chunkCount
          ? `Morceau ${groqProgress.chunkIndex} sur ${groqProgress.chunkCount}`
          : "Préparation de l’audio"}
        elapsed={formatElapsed(operationStartedAt ? operationClock - operationStartedAt : 0)}
        cancelling={cancellingOperation}
        onCancel={() => void cancelLongOperation("transcription")}
      />
    );
  }

  function renderNextProjectAction() {
    if (!loadedProject || busy || isHistoryPreview) return null;
    if (!loadedProjectHasVideo) {
      return (
        <section className="next-action" aria-label="Prochaine étape">
          <div><strong>Prochaine étape</strong><span>Ajoute la vidéo au projet.</span></div>
          <button className="primary-action" onClick={() => void importLocalVideoDesktop(loadedProject)}>
            <FileInput size={16} /><span>Importer une vidéo</span>
          </button>
        </section>
      );
    }
    if (!transcript) {
      return (
        <section className="next-action" aria-label="Prochaine étape">
          <div><strong>Prochaine étape</strong><span>Crée ou importe la transcription.</span></div>
          <button
            className="primary-action"
            disabled={Boolean(loadedProject.groqTranscribedAt)}
            title={loadedProject.groqTranscribedAt ? "Cette vidéo a déjà consommé un appel Groq" : "Transcrire la vidéo avec Groq"}
            onClick={() => void transcribeGroqDesktop(loadedProject)}
          >
            <Cloud size={16} /><span>Transcrire avec Groq</span>
          </button>
        </section>
      );
    }
    if (!attachedTranslation) {
      return (
        <section className="next-action" aria-label="Prochaine étape">
          <div><strong>Prochaine étape</strong><span>Prépare la traduction à partir de la transcription corrigée.</span></div>
          <button className="primary-action" onClick={() => void copyTranslationPromptDesktop()}>
            <Copy size={16} /><span>{copyState}</span>
          </button>
        </section>
      );
    }
    return (
      <section className="next-action" aria-label="Prochaine étape">
        <div><strong>Prochaine étape</strong><span>La traduction est prête à être exportée.</span></div>
        <button className="primary-action" onClick={() => void exportVideoDesktop("translation")}>
          <Download size={16} /><span>Exporter la traduction</span>
        </button>
      </section>
    );
  }

  return (
    <main className="desktop-shell">
      <header className={`desktop-header ${desktopView !== "library" ? "desktop-header-editor" : ""}`}>
        {desktopView === "editor" ? (
          <>
            <button className="back-button" onClick={() => void returnToLibrary()} title="Retourner aux projets">
              <ArrowLeft size={16} />
              <span>Projets</span>
            </button>
            <div>
              <strong dir="auto">{loadedProject?.title ?? "Projet"}</strong>
              <span>{loadedProject ? projectStatusLabel(loadedProject) : "Chargement"}</span>
            </div>
            <div className="editor-header-actions">
              <button disabled={!loadedProject || busy} onClick={openRenameProject} title="Renommer le projet">
                <Pencil size={16} />
                <span>Renommer</span>
              </button>
              <button className="icon-button" onClick={() => setShortcutsOpen(true)} title="Aide et raccourcis - ?" aria-label="Aide et raccourcis">
                <CircleHelp size={18} />
              </button>
            </div>
          </>
        ) : desktopView === "options" ? (
          <>
            <button className="back-button" onClick={() => void returnToLibrary()} title="Retourner aux projets">
              <ArrowLeft size={16} />
              <span>Projets</span>
            </button>
            <div>
              <strong>Options</strong>
              <span>Réglages de l’application</span>
            </div>
          </>
        ) : (
          <div>
            <strong>Tarjama Studio</strong>
            <span>Bibliothèque locale</span>
          </div>
        )}
        {desktopView === "library" && (
          <div className="desktop-header-actions">
            <button disabled={busy} onClick={() => void refreshLibrary()}>
              <RotateCcw size={16} />
              <span>Actualiser</span>
            </button>
            <button onClick={() => setDesktopView("options")}>
              <Settings size={16} />
              <span>Options</span>
            </button>
          </div>
        )}
      </header>

      {desktopView === "library" && (
        <>
          <section className="desktop-projects">
            <div className="library-heading">
              <div>
                <h1>Projets</h1>
                <p>Bibliothèque locale</p>
              </div>
              <button className="primary-action" onClick={() => openNewProject()}>
                <Plus size={16} />
                <span>Nouveau projet</span>
              </button>
            </div>
            {!activeProjects.length && <p className="state">Aucun projet actif.</p>}
            {activeProjects.map(renderProject)}
            {archivedProjects.length > 0 && (
              <>
                <button className="archive-toggle" onClick={() => setShowArchives((value) => !value)}>
                  {showArchives ? "Masquer les archives" : `Afficher les archives (${archivedProjects.length})`}
                </button>
                {showArchives && archivedProjects.map(renderProject)}
              </>
            )}
            {error && <ErrorNotice details={error} onRetry={lastActionRef.current ?? undefined} />}
            {library && <p className="desktop-path">{library.libraryDir}</p>}
          </section>
        </>
      )}

      {desktopView === "options" && (
        <section className="options-page">
          <section className="options-section">
            <div className="options-section-heading">
              <div>
                <h1>Apparence</h1>
                <span>Thème utilisé au prochain démarrage inclus.</span>
              </div>
            </div>
            <div className="theme-options" role="group" aria-label="Thème de l’application">
              <button className={theme === "dark" ? "selected" : ""} onClick={() => setTheme("dark")}>
                <Moon size={16} />
                <span>Sombre</span>
              </button>
              <button className={theme === "light" ? "selected" : ""} onClick={() => setTheme("light")}>
                <Sun size={16} />
                <span>Clair</span>
              </button>
            </div>
          </section>

          <section className="options-section">
            <div className="options-section-heading">
              <div>
                <h1>Clé API Groq</h1>
                <span>
                  {groqKeyStatus.source === "stored"
                    ? "Une clé personnelle est enregistrée localement sur cette machine."
                    : groqKeyStatus.source === "bundled-default"
                      ? "La clé Groq par défaut de l’application est utilisée."
                    : groqKeyStatus.source === "development-env"
                      ? "La clé de développement du fichier .env est utilisée."
                      : "Aucune clé configurée."}
                </span>
              </div>
            </div>
            <div className="option-inline-form">
              <input
                type="password"
                autoComplete="off"
                value={groqApiKey}
                onChange={(event) => setGroqApiKey(event.target.value)}
                placeholder="gsk_..."
              />
              <button disabled={!groqApiKey.trim()} onClick={() => void saveGroqKeyDesktop()}>
                <Save size={16} />
                <span>Enregistrer</span>
              </button>
              {groqKeyStatus.source === "stored" && (
                <button className="danger-button" onClick={() => void clearGroqKeyDesktop()}>
                  <Trash2 size={16} />
                  <span>Supprimer</span>
                </button>
              )}
            </div>
          </section>

          <section className="options-section">
            <div className="options-section-heading">
              <div>
                <h1>Outils vidéo</h1>
                <span>Met à jour le téléchargeur YouTube embarqué sans réinstaller l’application.</span>
              </div>
              <button disabled={busy} onClick={() => void updateYtdlpDesktop()}>
                <RotateCcw size={16} />
                <span>Mettre à jour yt-dlp</span>
              </button>
            </div>
          </section>

          <section className="options-section prompt-option">
            <div className="options-section-heading">
              <div>
                <h1>Prompt de correction</h1>
                <span>{promptSettings?.transcriptCleanupCustomized ? "Version personnalisée" : "Version par défaut"}</span>
              </div>
              <div className="options-actions">
                <button
                  disabled={!promptSettings?.transcriptCleanupCustomized && !cleanupPromptChanged}
                  onClick={() => void resetPromptDesktop("transcript_cleanup")}
                >
                  <RotateCcw size={16} />
                  <span>Revenir au défaut</span>
                </button>
                <button disabled={!cleanupPromptDraft.trim() || !cleanupPromptChanged} onClick={() => void savePromptDesktop("transcript_cleanup")}>
                  <Save size={16} />
                  <span>Enregistrer</span>
                </button>
              </div>
            </div>
            <textarea value={cleanupPromptDraft} onChange={(event) => setCleanupPromptDraft(event.target.value)} />
          </section>

          <section className="options-section prompt-option">
            <div className="options-section-heading">
              <div>
                <h1>Prompt de traduction</h1>
                <span>{promptSettings?.translationCustomized ? "Version personnalisée" : "Version par défaut"}</span>
              </div>
              <div className="options-actions">
                <button
                  disabled={!promptSettings?.translationCustomized && !translationPromptChanged}
                  onClick={() => void resetPromptDesktop("translation")}
                >
                  <RotateCcw size={16} />
                  <span>Revenir au défaut</span>
                </button>
                <button disabled={!translationPromptDraft.trim() || !translationPromptChanged} onClick={() => void savePromptDesktop("translation")}>
                  <Save size={16} />
                  <span>Enregistrer</span>
                </button>
              </div>
            </div>
            <textarea value={translationPromptDraft} onChange={(event) => setTranslationPromptDraft(event.target.value)} />
          </section>

          <p className="desktop-state">{optionsState}</p>
          {error && <ErrorNotice details={error} />}
        </section>
      )}

      {desktopView === "editor" && !loadedProject && (
        <section className="desktop-panel">
          <p className="state">{busy ? "Chargement du projet..." : "Aucun projet ouvert."}</p>
          {error && <ErrorNotice details={error} />}
        </section>
      )}

      {desktopView === "editor" && loadedProject && (
        <section className="desktop-editor">
          <div className="document-strip">
            <div className="video-meta">
              <strong>{loadedProject.title}</strong>
              <span>{formatTime(duration || loadedProject.durationSeconds || 0)}</span>
              <span className={`save-indicator save-indicator-${saveStatus}`} role="status">
                {saveStatus === "dirty" ? "Modifications non sauvegardées" : saveStatus === "saving" ? "Sauvegarde..." : "Sauvegardé"}
              </span>
            </div>
            <div className="document-actions" ref={actionMenusRef}>
              <button
                disabled={!transcript || editorLocked || saveStatus !== "dirty" || segmentIssues.length > 0}
                onClick={() => void createSavePointDesktop()}
                title={!transcript
                  ? "Importe d’abord une transcription"
                  : isHistoryPreview
                    ? "Une ancienne sauvegarde est en lecture seule"
                    : segmentIssues.length
                      ? "Corrige les erreurs d’horodatage avant de sauvegarder"
                      : saveStatus === "saved"
                        ? "Aucune modification à sauvegarder"
                        : "Créer une sauvegarde - Ctrl/Cmd+S"}
              >
                <Save size={16} />
                <span>{saveStatus === "saving" ? "Sauvegarde..." : "Sauvegarder"}</span>
              </button>

              <div className={`action-menu ${openActionMenu === "transcription" ? "open" : ""}`}>
                <button
                  className="action-menu-trigger"
                  aria-expanded={openActionMenu === "transcription"}
                  onClick={() => setOpenActionMenu((value) => (value === "transcription" ? null : "transcription"))}
                >
                  <span>Transcription</span>
                </button>
                {openActionMenu === "transcription" && (
                  <div className="action-menu-content">
                    <button
                      disabled={busy || isHistoryPreview || !loadedProjectHasVideo}
                      title={!loadedProjectHasVideo ? "Ajoute d’abord une vidéo" : isHistoryPreview ? "Une ancienne sauvegarde est en lecture seule" : "Importer une transcription JSON"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        void importTranscriptDesktop(loadedProject);
                      }}
                    >
                      <Upload size={16} />
                      <span>{loadedProject.transcriptPath ? "Remplacer transcription" : "Importer transcription"}</span>
                    </button>
                    <button
                      disabled={busy || isHistoryPreview || !loadedProjectHasVideo || Boolean(loadedProject.groqTranscribedAt)}
                      title={!loadedProjectHasVideo
                        ? "Ajoute d’abord une vidéo"
                        : loadedProject.groqTranscribedAt
                          ? "Cette vidéo a déjà été transcrite avec Groq"
                          : isHistoryPreview ? "Une ancienne sauvegarde est en lecture seule" : "Transcrire avec Whisper Large V3 sur Groq"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        void transcribeGroqDesktop(loadedProject);
                      }}
                    >
                      <Cloud size={16} />
                      <span>{loadedProject.groqTranscribedAt ? "Déjà transcrit avec Groq" : "Transcrire avec Groq"}</span>
                    </button>
                    <button
                      disabled={busy || isHistoryPreview || !transcript}
                      title={!transcript ? "Importe d’abord une transcription" : "Copier le prompt de nettoyage"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        void copyCleanupPromptDesktop();
                      }}
                    >
                      <Copy size={16} />
                      <span>{cleanupCopyState}</span>
                    </button>
                    <button
                      disabled={busy || isHistoryPreview || !transcript}
                      title={!transcript ? "Importe d’abord une transcription" : "Coller une transcription nettoyée"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        setCleanupImportOpen(true);
                      }}
                    >
                      <ClipboardPaste size={16} />
                      <span>Coller transcription nettoyée</span>
                    </button>
                    <button
                      disabled={busy || isHistoryPreview || !transcript}
                      title={!transcript ? "Importe d’abord une transcription" : "Choisir une transcription nettoyée"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        void importCleanedTranscriptFileDesktop();
                      }}
                    >
                      <Upload size={16} />
                      <span>Importer transcription nettoyée</span>
                    </button>
                  </div>
                )}
              </div>

              <div className={`action-menu ${openActionMenu === "translation" ? "open" : ""}`}>
                <button
                  className="action-menu-trigger"
                  aria-expanded={openActionMenu === "translation"}
                  onClick={() => setOpenActionMenu((value) => (value === "translation" ? null : "translation"))}
                >
                  <span>Traduction</span>
                </button>
                {openActionMenu === "translation" && (
                  <div className="action-menu-content">
                    <button
                      disabled={!transcript || editorLocked}
                      title={!transcript ? "Importe d’abord une transcription" : isHistoryPreview ? "Une ancienne sauvegarde est en lecture seule" : "Copier le prompt de traduction"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        void copyTranslationPromptDesktop();
                      }}
                    >
                      <Copy size={16} />
                      <span>{copyState}</span>
                    </button>
                    <button
                      disabled={!transcript || editorLocked || !loadedProjectHasVideo}
                      title={!loadedProjectHasVideo ? "Ajoute d’abord une vidéo" : !transcript ? "Importe d’abord une transcription" : "Coller une traduction"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        setPasteImportOpen(true);
                      }}
                    >
                      <ClipboardPaste size={16} />
                      <span>Coller traduction</span>
                    </button>
                    <button
                      disabled={!transcript || editorLocked || !loadedProjectHasVideo}
                      title={!loadedProjectHasVideo ? "Ajoute d’abord une vidéo" : !transcript ? "Importe d’abord une transcription" : "Choisir une traduction"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        void importTranslationFileDesktop();
                      }}
                    >
                    <Upload size={16} />
                      <span>{attachedTranslation ? "Remplacer traduction" : "Importer traduction"}</span>
                    </button>
                  </div>
                )}
              </div>

              <div className={`action-menu action-menu-export ${openActionMenu === "export" ? "open" : ""}`}>
                <button
                  className="action-menu-trigger"
                  aria-expanded={openActionMenu === "export"}
                  onClick={() => setOpenActionMenu((value) => (value === "export" ? null : "export"))}
                >
                  <span>Exporter</span>
                </button>
                {openActionMenu === "export" && (
                  <div className="action-menu-content">
                    <label className="export-option">
                      <span>Style sous-titres</span>
                      <select
                        value={exportOptions.style}
                        onChange={(event) => setExportOptions((value) => ({
                          ...value,
                          style: event.target.value as ExportSubtitleStyle,
                        }))}
                      >
                        <option value="black-band">Fond noir</option>
                        <option value="outline">Texte seul</option>
                      </select>
                    </label>
                    <label className="export-option">
                      <span>Taille du texte</span>
                      <select
                        value={exportOptions.subtitleSize}
                        onChange={(event) => setExportOptions((value) => ({
                          ...value,
                          subtitleSize: event.target.value as ExportSubtitleSize,
                        }))}
                      >
                        <option value="compact">Compacte</option>
                        <option value="standard">Standard (recommandée)</option>
                        <option value="large">Grande lisibilité</option>
                      </select>
                    </label>
                    <label className="export-option">
                      <span>Qualité vidéo</span>
                      <select
                        value={exportOptions.videoQuality}
                        onChange={(event) => setExportOptions((value) => ({
                          ...value,
                          videoQuality: event.target.value as ExportVideoQuality,
                        }))}
                      >
                        <option value="original">Résolution originale</option>
                        <option value="mobile-720p">Mobile 720p (recommandée)</option>
                        <option value="compact-480p">Très légère 480p</option>
                      </select>
                    </label>
                    <label className="export-option">
                      <span>Regroupement</span>
                      <select
                        value={exportOptions.cueGrouping}
                        onChange={(event) => setExportOptions((value) => ({
                          ...value,
                          cueGrouping: event.target.value as ExportCueGrouping,
                        }))}
                      >
                        <option value="automatic">Automatique (recommandé)</option>
                        <option value="source">Conserver les segments</option>
                        <option value="minimum-words">Minimum de mots</option>
                      </select>
                    </label>
                    {exportOptions.cueGrouping === "minimum-words" && (
                      <label className="export-option export-minimum-words">
                        <span>Mots minimum</span>
                        <input
                          type="number"
                          min="2"
                          max="30"
                          value={exportOptions.minimumWords ?? 10}
                          onChange={(event) => setExportOptions((value) => ({
                            ...value,
                            minimumWords: Math.max(2, Math.min(30, Number(event.target.value) || 2)),
                          }))}
                        />
                      </label>
                    )}
                    <button
                      disabled={!transcript || editorLocked || !loadedProjectHasVideo || Boolean(exportingTrack)}
                      title={!loadedProjectHasVideo ? "Ajoute d’abord une vidéo" : !transcript ? "Importe d’abord une transcription" : "Exporter les sous-titres arabes"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        void exportVideoDesktop("arabic");
                      }}
                    >
                      <Download size={16} />
                      <span>{exportingTrack === "arabic" ? "Export arabe..." : "Export arabe"}</span>
                    </button>
                    <button
                      disabled={!transcript || editorLocked || !loadedProjectHasVideo || Boolean(exportingTrack)}
                      title={!loadedProjectHasVideo ? "Ajoute d’abord une vidéo" : !transcript ? "Importe d’abord une transcription" : "Exporter puis ouvrir la vidéo arabe"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        void exportVideoDesktop("arabic", true);
                      }}
                    >
                      <ExternalLink size={16} />
                      <span>{exportingTrack === "arabic" ? "Ouverture..." : "Export+ouvrir arabe"}</span>
                    </button>
                    <button
                      disabled={!attachedTranslation || editorLocked || !loadedProjectHasVideo || Boolean(exportingTrack)}
                      title={!loadedProjectHasVideo ? "Ajoute d’abord une vidéo" : !attachedTranslation ? "Importe d’abord une traduction" : "Exporter la traduction"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        void exportVideoDesktop("translation");
                      }}
                    >
                      <Download size={16} />
                      <span>{exportingTrack === "translation" ? "Export traduction..." : "Export traduction"}</span>
                    </button>
                    <button
                      disabled={!attachedTranslation || editorLocked || !loadedProjectHasVideo || Boolean(exportingTrack)}
                      title={!loadedProjectHasVideo ? "Ajoute d’abord une vidéo" : !attachedTranslation ? "Importe d’abord une traduction" : "Exporter puis ouvrir la traduction"}
                      onClick={() => {
                        setOpenActionMenu(null);
                        void exportVideoDesktop("translation", true);
                      }}
                    >
                      <ExternalLink size={16} />
                      <span>{exportingTrack === "translation" ? "Ouverture..." : "Export+ouvrir traduction"}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {renderExportProgress()}
          {renderGroqProgress()}
          {error && (
            <ErrorNotice
              details={error}
              onRetry={lastActionRef.current ?? undefined}
              onOptions={/groq|clé api|api key/i.test(error) ? () => setDesktopView("options") : undefined}
              onChooseAnother={importPreview ? () => void chooseImportFile(importPreview.kind) : undefined}
            />
          )}
          {renderNextProjectAction()}

          <section className="media-tools">
            <div>
              <strong>Vidéo</strong>
              <span>
                {loadedProject.videoPath
                  ? "Vidéo prête pour l’écoute et l’export."
                  : loadedProject.youtubeUrl
                    ? "Ajoute la vidéo depuis YouTube ou depuis ton ordinateur avant transcription, traduction ou export."
                    : "Importe une vidéo avant transcription, traduction ou export."}
              </span>
            </div>
            {loadedProject.videoPath ? (
              <details className="media-management">
                <summary><Settings size={16} /><span>Gérer la vidéo</span></summary>
                <div className="media-management-content">
                  <p>Ces opérations remplacent uniquement le fichier vidéo. La transcription et la traduction restent attachées au projet.</p>
                  <div className="media-tool-actions">
                    <button disabled={busy || !loadedProject.youtubeUrl} onClick={() => void analyzeYoutubeFormatsDesktop(loadedProject)} title={!loadedProject.youtubeUrl ? "Ce projet n’a pas de lien YouTube" : "Choisir une autre qualité YouTube"}>
                      <RotateCcw size={16} />
                      <span>Télécharger une autre qualité</span>
                    </button>
                    <button disabled={busy} onClick={() => void importLocalVideoDesktop(loadedProject)}>
                      <FileInput size={16} />
                      <span>Remplacer par un fichier local</span>
                    </button>
                  </div>
                  {youtubeFormats.length > 0 && youtubeFormatProjectId === loadedProject.id && (
                    <div className="youtube-download-choice">
                      <label className="youtube-format-picker">
                        <span>{youtubeFormatTitle ? `Nouvelle qualité pour ${youtubeFormatTitle}` : "Nouvelle qualité"}</span>
                        <select value={selectedYoutubeFormat} onChange={(event) => setSelectedYoutubeFormat(event.target.value)}>
                          {youtubeFormats.map((format) => (
                            <option key={format.id} value={format.formatSelector}>{format.label}</option>
                          ))}
                        </select>
                      </label>
                      <button disabled={busy || !selectedYoutubeFormat} onClick={() => void downloadYoutubeDesktop(loadedProject)}>
                        <Download size={16} />
                        <span>Remplacer la vidéo</span>
                      </button>
                    </div>
                  )}
                </div>
              </details>
            ) : (
              <>
                <div className="media-tool-actions">
                  <button disabled={busy || !loadedProject.youtubeUrl} onClick={() => void analyzeYoutubeFormatsDesktop(loadedProject)} title={!loadedProject.youtubeUrl ? "Ce projet n’a pas de lien YouTube" : "Choisir la qualité avant téléchargement"}>
                    <RotateCcw size={16} />
                    <span>Choisir la qualité à télécharger</span>
                  </button>
                  <button disabled={busy} onClick={() => void importLocalVideoDesktop(loadedProject)}>
                    <FileInput size={16} />
                    <span>Importer une vidéo locale</span>
                  </button>
                </div>
                {youtubeFormats.length > 0 && youtubeFormatProjectId === loadedProject.id && (
                  <div className="youtube-download-choice">
                    <label className="youtube-format-picker">
                      <span>{youtubeFormatTitle ? `Qualité à télécharger pour ${youtubeFormatTitle}` : "Qualité à télécharger"}</span>
                      <select value={selectedYoutubeFormat} onChange={(event) => setSelectedYoutubeFormat(event.target.value)}>
                        {youtubeFormats.map((format) => (
                          <option key={format.id} value={format.formatSelector}>{format.label}</option>
                        ))}
                      </select>
                    </label>
                    <button disabled={busy || !selectedYoutubeFormat} onClick={() => void downloadYoutubeDesktop(loadedProject)}>
                      <Download size={16} />
                      <span>Télécharger depuis YouTube</span>
                    </button>
                  </div>
                )}
              </>
            )}
            {loadedProject.youtubeUrlWarning && <p className="warning">{loadedProject.youtubeUrlWarning}</p>}
            {busy && <p className="desktop-state">{state}</p>}
            {renderDownloadProgress()}
            {downloadProgress?.stage === "done" && (
              <p className="desktop-state">Téléchargement terminé. La vidéo est attachée au projet.</p>
            )}
          </section>

          {mediaUrl && (
            <section className="player-band">
              {resumePoint && (
                <div className="resume-prompt" role="status">
                  <span>Dernière écoute à <strong>{formatTime(resumePoint.time)}</strong></span>
                  <div>
                    <button className="primary-action" onClick={acceptResumePoint}>Reprendre à {formatTime(resumePoint.time)}</button>
                    <button onClick={restartProjectPlayback}>Recommencer</button>
                  </div>
                </div>
              )}
              <audio
                ref={audioRef}
                src={mediaUrl}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={() => {
                  if (audioRef.current) audioRef.current.playbackRate = playbackRate;
                  setDuration(audioRef.current?.duration ?? loadedProject.durationSeconds ?? 0);
                }}
              />
              <div className="interval-row">
                <label>
                  <span>Début</span>
                  <input value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
                  <button onClick={() => setRangeStart(formatTime(currentTime))} title="Prendre le temps courant comme début - D" aria-label="Prendre le temps courant comme début">
                    <FileInput size={16} />
                  </button>
                </label>
                <label>
                  <span>Fin</span>
                  <input value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
                  <button onClick={() => setRangeEnd(formatTime(currentTime))} title="Prendre le temps courant comme fin - F" aria-label="Prendre le temps courant comme fin">
                    <FileInput size={16} />
                  </button>
                </label>
                <label className="toggle" title={hasInterval ? "Activer ou désactiver la boucle - B" : "Définis d’abord un intervalle valide"}>
                  <input disabled={!hasInterval} checked={loopEnabled} type="checkbox" onChange={(event) => setLoopEnabled(event.target.checked)} />
                  <span>Boucle</span>
                </label>
                <button disabled={!hasInterval} className="interval-clear" onClick={clearInterval} title={hasInterval ? "Quitter l’intervalle - Échap" : "Aucun intervalle actif"}>
                  <X size={16} />
                  <span>Quitter l’intervalle</span>
                </button>
              </div>
              <div className={`playback-mode playback-mode-${playbackMode === "Lecture libre" ? "free" : playbackMode === "Boucle" ? "loop" : "range"}`}>
                <strong>{playbackMode}</strong>
                {hasInterval && <span>{rangeStart} → {rangeEnd}</span>}
              </div>
              <div
                className="timeline-wrap"
                onPointerMove={updateDesktopTimelineHover}
                onPointerLeave={() => setTimelineHover(null)}
              >
                {timelineHover ? (
                  <div className="timeline-tooltip" style={{ left: `${timelineHover.x}%` }}>
                    {formatTime(timelineHover.time)}
                  </div>
                ) : null}
                <input
                  className="timeline"
                  type="range"
                  min="0"
                  max={duration || loadedProject.durationSeconds || 0}
                  step="0.01"
                  value={currentTime}
                  onChange={(event) => seekTo(Number(event.target.value))}
                />
                <div className="timeline-readout">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration || loadedProject.durationSeconds || 0)}</span>
                </div>
              </div>
              <div className="player-control-row">
                <div className="audio-controls">
                  <button onClick={() => seekBy(-10)} title="Reculer de 10 secondes - Maj+←">-10s</button>
                  <button onClick={() => seekBy(-3)} title="Reculer de 3 secondes - ←">-3s</button>
                  <button className="primary-control" onClick={togglePlay} title={`${isPlaying ? "Pause" : "Lecture"} - Espace`}>
                    {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                    <span>{isPlaying ? "Pause" : "Lire"}</span>
                  </button>
                  <button onClick={() => seekBy(3)} title="Avancer de 3 secondes - →">+3s</button>
                  <button onClick={() => seekBy(10)} title="Avancer de 10 secondes - Maj+→">+10s</button>
                  <button disabled={!hasInterval} className="interval-return" onClick={returnToInterval} title={hasInterval ? "Aller au début de l’intervalle" : "Aucun intervalle actif"}>
                    <RotateCcw size={16} />
                    <span>Début de l’intervalle</span>
                  </button>
                </div>
                <label className="playback-rate">
                  <span>Vitesse</span>
                  <select title="Vitesse de lecture - − / +" value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))}>
                    {PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{String(rate).replace(".", ",")}×</option>)}
                  </select>
                </label>
              </div>
              <div className="player-nav">
                <button className="icon-button" disabled={!displayedTranscript} onClick={() => navigateAdjacentSegment(-1)} title="Segment précédent - Alt+Haut" aria-label="Segment précédent">
                  <ArrowUp size={16} />
                </button>
                <button disabled={!displayedTranscript} onClick={scrollToCurrentSegment} title="Aller au segment du temps courant - S">
                  <LocateFixed size={16} />
                  <span>Segment</span>
                </button>
                <button className="icon-button" disabled={!displayedTranscript} onClick={() => navigateAdjacentSegment(1)} title="Segment suivant - Alt+Bas" aria-label="Segment suivant">
                  <ArrowDown size={16} />
                </button>
                <button onClick={scrollToTop} title="Remonter en haut de la page">
                  <ArrowUpToLine size={16} />
                  <span>Haut</span>
                </button>
              </div>
            </section>
          )}

          {snapshots.length > 0 && (
            <section className="snapshot-history">
              <div>
                <History size={16} />
                <strong>Historique</strong>
              </div>
              {currentSaveSnapshot && (
                <span className="current-save-label">Dernière sauvegarde: {snapshotLabel(currentSaveSnapshot)}</span>
              )}
              <select value={selectedSnapshotId} onChange={(event) => void selectDesktopSnapshot(event.target.value)}>
                <option value="">Version courante</option>
                {oldSnapshots.map((snapshot) => (
                  <option key={snapshot.id} value={snapshot.id}>
                    {snapshotLabel(snapshot)}
                  </option>
                ))}
              </select>
              {isHistoryPreview && (
                <>
                  <button onClick={() => {
                    setSelectedSnapshotId("");
                    setPreviewSnapshot(null);
                    setPreviewTranscript(null);
                  }}>
                    Version courante
                  </button>
                  <button className="danger-button" onClick={() => void restoreDesktopSnapshot()}>
                    Restaurer...
                  </button>
                </>
              )}
            </section>
          )}

          {!transcript && <p className="state">Vidéo téléchargée. Importe une transcription nettoyée pour commencer l'édition.</p>}
          {isHistoryPreview && <p className="state">Ancienne sauvegarde en lecture seule.</p>}
          {searchOpen && displayedTranscript && (
            <section className="document-search" role="search">
              <Search size={17} />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchIndex(0);
                }}
                placeholder="Rechercher dans l’arabe et le français"
                aria-label="Rechercher dans la transcription"
              />
              <span>{searchQuery.trim() ? `${searchOccurrenceCount} occurrence(s)` : ""}</span>
              <button className="icon-button" disabled={!searchResults.length} onClick={() => navigateSearch(-1)} title="Résultat précédent" aria-label="Résultat précédent">
                <ArrowUp size={16} />
              </button>
              <button className="icon-button" disabled={!searchResults.length} onClick={() => navigateSearch(1)} title="Résultat suivant" aria-label="Résultat suivant">
                <ArrowDown size={16} />
              </button>
              <button className="icon-button" onClick={() => setSearchOpen(false)} title="Fermer la recherche - Échap" aria-label="Fermer la recherche">
                <X size={16} />
              </button>
            </section>
          )}
          {segmentIssues.length > 0 && (
            <section className="validation-summary" role="alert">
              <AlertTriangle size={17} />
              <span>{segmentIssues.length} erreur(s) d’horodatage à corriger avant la sauvegarde.</span>
              <button onClick={() => focusSegment(segmentIssues[0].segmentId, false)}>Voir la première</button>
            </section>
          )}
          {undoVisible && undoStack.length > 0 && (
            <div className="undo-toast" role="status">
              <span>Structure des segments modifiée.</span>
              <button onClick={undoLastStructuralEdit}><Undo2 size={15} /><span>Annuler</span></button>
            </div>
          )}
          {displayedTranscript && (
            <section className="workspace">
              <section className="segments">
                {displayedTranscript.segments.map((segment, index) => (
                  <article
                    className={[
                      "segment-row",
                      activeSegmentId === segment.id ? "segment-row-active" : "",
                      focusedSegmentId === segment.id ? "segment-row-focused" : "",
                      issuesBySegment.has(segment.id) ? "segment-row-invalid" : "",
                    ].filter(Boolean).join(" ")}
                    key={segment.id}
                    aria-current={activeSegmentId === segment.id ? "true" : undefined}
                    ref={(element) => {
                      if (element) segmentRefs.current.set(segment.id, element);
                      else segmentRefs.current.delete(segment.id);
                    }}
                  >
                    <div className="segment-meta">
                      <label className="time-control time-control-nav">
                        <span>Lire</span>
                        <button className="timestamp" onClick={() => seekTo(segment.start)} title="Lire depuis ce segment">
                          {formatTime(segment.start)}
                        </button>
                      </label>
                      <label className="time-control">
                        <span>Début</span>
                        <input
                          className="time-input"
                          disabled={editorLocked}
                          value={formatTime(segment.start)}
                          onChange={(event) => updateSegment(segment.id, { start: parseTime(event.target.value) ?? segment.start })}
                        />
                      </label>
                      <label className="time-control">
                        <span>Fin</span>
                        <input
                          className="time-input"
                          disabled={editorLocked}
                          value={formatTime(segment.end)}
                          onChange={(event) => updateSegment(segment.id, { end: parseTime(event.target.value) ?? segment.end })}
                        />
                      </label>
                    </div>
                    {issuesBySegment.has(segment.id) && (
                      <button className="segment-error" onClick={() => focusSegment(segment.id, false)}>
                        <AlertTriangle size={15} />
                        <span>{issuesBySegment.get(segment.id)?.join(" · ")}</span>
                      </button>
                    )}
                    <div className="segment-fields">
                      <textarea
                        dir="rtl"
                        lang="ar"
                        disabled={editorLocked}
                        ref={(element) => {
                          const key = `${segment.id}:text`;
                          if (element) segmentFieldRefs.current.set(key, element);
                          else segmentFieldRefs.current.delete(key);
                        }}
                        value={segment.text}
                        onChange={(event) => updateSegment(segment.id, { text: event.target.value })}
                      />
                      <textarea
                        disabled={editorLocked || !attachedTranslation}
                        ref={(element) => {
                          const key = `${segment.id}:translation`;
                          if (element) segmentFieldRefs.current.set(key, element);
                          else segmentFieldRefs.current.delete(key);
                        }}
                        value={segment.translation}
                        placeholder={attachedTranslation ? "Traduction" : "Importer une traduction alignée"}
                        onChange={(event) => updateSegment(segment.id, { translation: event.target.value })}
                      />
                      <div className="segment-actions">
                        <button disabled={editorLocked} onClick={() => addSegmentAfter(segment.id)} title={editorLocked ? "Modification désactivée en lecture seule" : "Ajouter un segment après"} aria-label="Ajouter un segment après">
                          <Plus size={16} />
                        </button>
                        <button
                          disabled={editorLocked || currentTime <= segment.start || currentTime >= segment.end}
                          onClick={() => splitSegment(segment.id)}
                          title={editorLocked
                            ? "Modification désactivée en lecture seule"
                            : currentTime <= segment.start || currentTime >= segment.end
                              ? "Place le curseur strictement à l’intérieur de ce segment"
                              : `Scinder au temps ${formatTime(currentTime)}`}
                          aria-label="Scinder le segment au temps courant"
                        >
                          <Scissors size={16} />
                        </button>
                        <button
                          disabled={editorLocked || index >= displayedTranscript.segments.length - 1}
                          onClick={() => mergeWithNext(segment.id)}
                          title={editorLocked
                            ? "Modification désactivée en lecture seule"
                            : index >= displayedTranscript.segments.length - 1
                              ? "Aucun segment suivant à fusionner"
                              : "Fusionner avec le segment suivant"}
                          aria-label="Fusionner avec le segment suivant"
                        >
                          <Combine size={16} />
                        </button>
                        <button disabled={editorLocked} onClick={() => deleteSegment(segment.id)} title={editorLocked ? "Modification désactivée en lecture seule" : "Supprimer ce segment"} aria-label="Supprimer ce segment">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            </section>
          )}
        </section>
      )}

      {newProjectOpen && (
        <AccessibleModal
          className="new-project-modal"
          labelledBy="new-project-title"
          onClose={closeNewProject}
          closeOnBackdrop={!busy}
          closeDisabled={busy}
        >
            <div className="modal-heading">
              <div>
                <h2 id="new-project-title">Nouveau projet</h2>
                <p>Choisis d’abord la source de la vidéo.</p>
              </div>
              <ModalCloseButton disabled={busy} onClick={closeNewProject} />
            </div>

            <div className="creation-tabs" role="tablist" aria-label="Source de la vidéo">
              <button
                aria-selected={newProjectMode === "youtube"}
                className={newProjectMode === "youtube" ? "selected" : ""}
                role="tab"
                onClick={() => {
                  setNewProjectMode("youtube");
                  setError("");
                }}
              >
                <span>YouTube</span>
              </button>
              <button
                aria-selected={newProjectMode === "local"}
                className={newProjectMode === "local" ? "selected" : ""}
                role="tab"
                onClick={() => {
                  setNewProjectMode("local");
                  setError("");
                }}
              >
                <span>Fichier local</span>
              </button>
            </div>

            {newProjectMode === "youtube" ? (
              <section className="creation-content" role="tabpanel">
                <label>
                  <span>Lien YouTube</span>
                  <input
                    data-autofocus
                    value={newYoutubeUrl}
                    onChange={(event) => {
                      setNewYoutubeUrl(event.target.value);
                      setNewYoutubeFormats([]);
                      setNewSelectedYoutubeFormat("");
                      setNewYoutubeTitle("");
                    }}
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </label>
                {!newYoutubeFormats.length ? (
                  <div className="modal-actions">
                    <button disabled={busy} onClick={closeNewProject}>Annuler</button>
                    <button disabled={busy || !newYoutubeUrl.trim()} onClick={() => void analyzeNewYoutubeProject()}>
                      <RotateCcw size={16} />
                      <span>{busy ? "Analyse..." : "Analyser la vidéo"}</span>
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="youtube-analysis-summary">
                      <strong dir="auto">{newYoutubeTitle || "Vidéo YouTube"}</strong>
                      <span>Choisis la qualité à télécharger. Le projet sera créé avec cette vidéo.</span>
                    </div>
                    <label className="youtube-format-picker">
                      <span>Qualité à télécharger</span>
                      <select value={newSelectedYoutubeFormat} onChange={(event) => setNewSelectedYoutubeFormat(event.target.value)}>
                        {newYoutubeFormats.map((format) => (
                          <option key={format.id} value={format.formatSelector}>{format.label}</option>
                        ))}
                      </select>
                    </label>
                    <div className="modal-actions">
                      <button disabled={busy} onClick={() => {
                        setNewYoutubeFormats([]);
                        setNewSelectedYoutubeFormat("");
                        setNewYoutubeTitle("");
                      }}>Modifier le lien</button>
                      <button disabled={busy || !newSelectedYoutubeFormat} onClick={() => void downloadNewYoutubeProject()}>
                        <Download size={16} />
                        <span>{busy ? "Téléchargement..." : "Télécharger et créer"}</span>
                      </button>
                    </div>
                  </>
                )}
                {busy && <p className="desktop-state">{state}</p>}
                {renderDownloadProgress()}
              </section>
            ) : (
              <section className="creation-content" role="tabpanel">
                <label>
                  <span>Titre du projet</span>
                  <input
                    data-autofocus
                    maxLength={200}
                    value={newProjectTitle}
                    onChange={(event) => setNewProjectTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") closeNewProject();
                    }}
                    placeholder="Ex. Cours sur la généalogie du Prophète"
                  />
                </label>
                <p className="creation-help">La vidéo choisie sera copiée dans la bibliothèque, puis le projet s’ouvrira directement.</p>
                <div className="modal-actions">
                  <button disabled={busy} onClick={closeNewProject}>Annuler</button>
                  <button disabled={busy || !newProjectTitle.trim()} onClick={() => void importNewLocalProjectVideo()}>
                    <FileInput size={16} />
                    <span>Choisir une vidéo</span>
                  </button>
                </div>
                <button
                  className="text-button"
                  disabled={busy || !newProjectTitle.trim()}
                  onClick={() => void createNewLocalProjectWithoutVideo()}
                >
                  Créer sans vidéo
                </button>
              </section>
            )}
            {error && <ErrorNotice details={error} />}
        </AccessibleModal>
      )}

      {shortcutsOpen && (
        <AccessibleModal
          className="shortcuts-modal"
          labelledBy="shortcuts-title"
          onClose={() => setShortcutsOpen(false)}
          closeKeys={["Escape", "q", "?"]}
        >
            <div className="modal-heading">
              <div>
                <h2 id="shortcuts-title">Aide et raccourcis</h2>
                <p>Actifs hors des champs de texte.</p>
              </div>
              <ModalCloseButton onClick={() => setShortcutsOpen(false)} />
            </div>
            <div className="shortcut-groups">
              <section><h3>Lecture</h3><dl className="shortcuts-list">
                <div><dt>Espace</dt><dd>Lire ou mettre en pause</dd></div>
                <div><dt>← / →</dt><dd>Reculer ou avancer de 3 secondes</dd></div>
                <div><dt>Maj + ← / →</dt><dd>Reculer ou avancer de 10 secondes</dd></div>
                <div><dt>− / +</dt><dd>Réduire ou augmenter la vitesse</dd></div>
              </dl></section>
              <section><h3>Intervalle</h3><dl className="shortcuts-list">
                <div><dt>D</dt><dd>Définir le début</dd></div>
                <div><dt>F</dt><dd>Définir la fin</dd></div>
                <div><dt>B</dt><dd>Activer ou désactiver la boucle</dd></div>
                <div><dt>Échap</dt><dd>Quitter l’intervalle</dd></div>
              </dl></section>
              <section><h3>Navigation</h3><dl className="shortcuts-list">
                <div><dt>S</dt><dd>Aller au segment courant</dd></div>
                <div><dt>Alt + ↑ / ↓</dt><dd>Segment précédent ou suivant</dd></div>
                <div><dt>Ctrl/Cmd + F</dt><dd>Rechercher dans le document</dd></div>
              </dl></section>
              <section><h3>Édition</h3><dl className="shortcuts-list">
                <div><dt>Ctrl/Cmd + S</dt><dd>Créer une sauvegarde</dd></div>
                <div><dt>Ctrl/Cmd + Z</dt><dd>Annuler une action structurelle hors d’un champ</dd></div>
                <div><dt>Q / ? / Échap</dt><dd>Fermer cette aide</dd></div>
              </dl></section>
            </div>
            <div className="modal-actions">
              <button onClick={() => setShortcutsOpen(false)}>Fermer</button>
            </div>
        </AccessibleModal>
      )}

      {pasteImportOpen && (
        <AccessibleModal className="paste-modal" labelledBy="paste-translation-title" onClose={() => setPasteImportOpen(false)}>
            <h2 id="paste-translation-title">Importer une traduction collée</h2>
            <p>Colle une traduction Tarjama Studio en Markdown. Les timestamps seront validés avant remplacement.</p>
            <textarea
              value={pastedTranslation}
              onChange={(event) => setPastedTranslation(event.target.value)}
              placeholder={'## 00:00.000 --> 00:03.440\nTraduction française.'}
            />
            {error && <ErrorNotice details={error} />}
            <div className="modal-actions">
              <button onClick={() => setPasteImportOpen(false)}>Annuler</button>
              <button disabled={!pastedTranslation.trim()} onClick={() => void importPastedTranslationDesktop()} title={!pastedTranslation.trim() ? "Colle d’abord une traduction" : "Prévisualiser l’import"}>
                <Check size={16} />
                <span>Prévisualiser</span>
              </button>
            </div>
        </AccessibleModal>
      )}

      {cleanupImportOpen && (
        <AccessibleModal className="paste-modal" labelledBy="paste-cleanup-title" onClose={() => setCleanupImportOpen(false)} closeOnBackdrop={!busy} closeDisabled={busy}>
            <h2 id="paste-cleanup-title">Importer la transcription nettoyée</h2>
            <p>
              Colle le Markdown horodaté renvoyé par le LLM. Les titres de blocs doivent reprendre exactement les timestamps source; seuls les textes peuvent être corrigés ou les blocs inutiles supprimés.
            </p>
            <textarea
              value={pastedCleanupTranscript}
              onChange={(event) => setPastedCleanupTranscript(event.target.value)}
              placeholder={'## 00:00.000 --> 00:03.440\nالنص العربي المصحح.'}
            />
            {cleanedPasteReview.lines.length > 0 && (
              <div className={`import-preview ${cleanedPasteReview.valid ? "valid" : "invalid"}`}>
                {cleanedPasteReview.lines.map((line) => <span key={line}>{line}</span>)}
              </div>
            )}
            {error && <ErrorNotice details={error} />}
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setCleanupImportOpen(false)}>Annuler</button>
              <button
                disabled={busy || !cleanedPasteReview.valid}
                onClick={() => previewPastedImport("cleanup", pastedCleanupTranscript)}
              >
                <Check size={16} />
                <span>Prévisualiser</span>
              </button>
            </div>
        </AccessibleModal>
      )}

      {renameProjectOpen && (
        <AccessibleModal labelledBy="rename-project-title" onClose={() => setRenameProjectOpen(false)} closeOnBackdrop={!busy} closeDisabled={busy}>
            <h2 id="rename-project-title">Renommer le projet</h2>
            <p>Ce titre sert uniquement à identifier le projet dans ta bibliothèque.</p>
            <input
              data-autofocus
              maxLength={200}
              value={projectTitleDraft}
              onChange={(event) => setProjectTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !busy) setRenameProjectOpen(false);
                if (event.key === "Enter" && projectTitleDraft.trim()) void renameProjectDesktop();
              }}
            />
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setRenameProjectOpen(false)}>Annuler</button>
              <button
                disabled={busy || !projectTitleDraft.trim() || projectTitleDraft.trim() === loadedProject?.title}
                onClick={() => void renameProjectDesktop()}
              >
                <Check size={16} />
                <span>Renommer</span>
              </button>
            </div>
        </AccessibleModal>
      )}

      {importPreview && (
        <AccessibleModal
          className="import-review-modal"
          labelledBy="import-review-title"
          onClose={() => setImportPreview(null)}
          closeOnBackdrop={!busy}
          closeDisabled={busy}
        >
          <div className="modal-heading">
            <div>
              <h2 id="import-review-title">Vérifier avant remplacement</h2>
              <p>{importPreview.filename}</p>
            </div>
            <ModalCloseButton disabled={busy} onClick={() => setImportPreview(null)} />
          </div>
          <div className={`import-review-summary ${importPreview.preview.valid ? "valid" : "invalid"}`}>
            <strong>{importPreview.preview.valid ? "Fichier prêt à importer" : "Import bloqué"}</strong>
            <span>{importPreview.preview.segmentCount} segment(s)</span>
            {importPreview.kind === "translation" && (
              <span>{importPreview.preview.alignedCount} timestamp(s) aligné(s) sur {transcript?.segments.length ?? 0}</span>
            )}
          </div>
          {importPreview.preview.errors.length > 0 && (
            <ul className="import-review-errors">
              {importPreview.preview.errors.map((message) => <li key={message}>{message}</li>)}
            </ul>
          )}
          <details className="import-content-details">
            <summary>Afficher le contenu</summary>
            <pre>{importPreview.content.slice(0, IMPORT_PREVIEW_CHARACTER_LIMIT)}</pre>
            {importPreview.content.length > IMPORT_PREVIEW_CHARACTER_LIMIT && (
              <p>Aperçu limité aux {IMPORT_PREVIEW_CHARACTER_LIMIT.toLocaleString("fr-FR")} premiers caractères. Le fichier complet sera importé.</p>
            )}
          </details>
          <div className="modal-actions">
            <button disabled={busy} onClick={() => void chooseImportFile(importPreview.kind)}>Choisir un autre fichier</button>
            <button disabled={busy} onClick={() => setImportPreview(null)}>Annuler</button>
            <button className="primary-action" disabled={busy || !importPreview.preview.valid} onClick={() => void confirmImportPreview()}>
              <Check size={16} /><span>Confirmer le remplacement</span>
            </button>
          </div>
        </AccessibleModal>
      )}

    </main>
  );
}

function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const translationFileRef = useRef<HTMLInputElement | null>(null);
  const currentSaveTimer = useRef<number | null>(null);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const [previewTranscript, setPreviewTranscript] = useState<Transcript | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<SnapshotInfo | null>(null);
  const [attachedTranslation, setAttachedTranslation] = useState<Translation | null>(null);
  const [translationState, setTranslationState] = useState("Aucune traduction");
  const [copyState, setCopyState] = useState("Copier prompt");
  const [pasteImportOpen, setPasteImportOpen] = useState(false);
  const [pastedTranslation, setPastedTranslation] = useState("");
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [exportState, setExportState] = useState("Export vidéo");
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [rangeStart, setRangeStart] = useState("00:00");
  const [rangeEnd, setRangeEnd] = useState("00:00");
  const [snapshotState, setSnapshotState] = useState("Sauvegarder");
  const [showRecoveryDiff, setShowRecoveryDiff] = useState(false);
  const [showPreviewDiff, setShowPreviewDiff] = useState(false);
  const [timelineHover, setTimelineHover] = useState<{ time: number; x: number } | null>(null);
  const [focusedSegmentId, setFocusedSegmentId] = useState("");
  const [undoSnapshot, setUndoSnapshot] = useState<Transcript | null>(null);
  const [textCaret, setTextCaret] = useState<{ segmentId: string; index: number } | null>(null);
  const segmentRefs = useRef(new Map<string, HTMLElement>());

  const selectedVideo = useMemo(
    () => videos.find((video) => video.corpus_id === selectedId) ?? null,
    [selectedId, videos]
  );
  const historySnapshots = useMemo(
    () => snapshots.filter((snapshot) => !snapshot.matches_current),
    [snapshots]
  );
  const displayedTranscript = previewTranscript ?? transcript;
  const displayedSegmentCount = displayedTranscript?.segments.length ?? 0;
  const isHistoryPreview = Boolean(previewTranscript);
  const showRecoveryBanner = Boolean(recovery?.needs_resolution && !isHistoryPreview);
  const editorLocked = Boolean(recovery?.needs_resolution) || isHistoryPreview;
  const recoveryDiff = useMemo(() => segmentDiff(transcript, recovery?.snapshot), [transcript, recovery]);
  const previewDiff = useMemo(() => segmentDiff(transcript, previewTranscript), [transcript, previewTranscript]);
  const recoverySummary = useMemo(
    () => ({
      added: recoveryDiff.filter((line) => line.kind === "added").length,
      removed: recoveryDiff.filter((line) => line.kind === "removed").length,
      changed: recoveryDiff.filter((line) => line.kind === "changed").length,
    }),
    [recoveryDiff]
  );
  const previewSummary = useMemo(
    () => ({
      added: previewDiff.filter((line) => line.kind === "added").length,
      removed: previewDiff.filter((line) => line.kind === "removed").length,
      changed: previewDiff.filter((line) => line.kind === "changed").length,
    }),
    [previewDiff]
  );
  useEffect(() => {
    api.videos().then(setVideos).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const loadTranscript = useCallback(async (video: VideoItem) => {
    setLoading(true);
    setError("");
    setTranscript(null);
    setRecovery(null);
    setSnapshots([]);
    setSelectedSnapshotId("");
    setPreviewTranscript(null);
    setPreviewSnapshot(null);
    setAttachedTranslation(null);
    setTranslationState("Aucune traduction");
    setCopyState("Copier prompt");
    setPasteImportOpen(false);
    setPastedTranslation("");
    setExportJob(null);
    setExportState("Export vidéo");
    setRestoreConfirm(false);
    setShowRecoveryDiff(false);
    setShowPreviewDiff(false);
    if (
      !video.has_workspace &&
      !video.has_autosave &&
      !video.has_model_transcript
    ) {
      setSnapshotState("Sauvegarder");
      setLoading(false);
      return;
    }
    try {
      const loaded = await api.ensureTranscript(video.corpus_id);
      const history = await api.snapshots(video.corpus_id);
      const loadedTranslation = await api.translation(video.corpus_id);
      setTranscript(applyTranslation(loaded.transcript, loadedTranslation));
      setAttachedTranslation(loadedTranslation);
      setTranslationState(loadedTranslation ? "Traduction attachée" : "Aucune traduction");
      setRecovery(loaded.recovery?.needs_resolution ? loaded.recovery : null);
      setSnapshots(history);
      setSelectedSnapshotId("");
      setSnapshotState("Sauvegarder");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedVideo) return;
    void loadTranscript(selectedVideo);
  }, [loadTranscript, selectedVideo]);

  useEffect(() => {
    if (!restoreConfirm && !pasteImportOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRestoreConfirm(false);
        setPasteImportOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pasteImportOpen, restoreConfirm]);

  useEffect(() => {
    if (!exportJob || !["queued", "running"].includes(exportJob.status)) return;
    const timer = window.setInterval(() => {
      api.exportJob(exportJob.id)
        .then((job) => {
          setExportJob(job);
          if (job.status === "completed") setExportState("Export terminé");
          if (job.status === "failed") setExportState("Export échoué");
        })
        .catch((err) => {
          setExportState("Export échoué");
          setError(err instanceof Error ? err.message : "Export vidéo impossible");
        });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [exportJob]);

  useEffect(() => {
    if (!transcript || !selectedId || editorLocked) return;
    if (currentSaveTimer.current) window.clearTimeout(currentSaveTimer.current);
    currentSaveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          await api.saveCurrent(selectedId, transcriptWithoutTranslations(transcript));
          if (attachedTranslation) {
            setTranslationState("Traduction enregistrement...");
            await api.saveTranslation(selectedId, translationFromTranscript(transcript, attachedTranslation));
            setTranslationState("Traduction attachée");
          }
        } catch (err) {
          if (attachedTranslation) setTranslationState("Traduction non sauvegardée");
          setError(err instanceof Error ? err.message : "L'état courant n'a pas pu être enregistré");
        }
      })();
    }, 900);
    return () => {
      if (currentSaveTimer.current) window.clearTimeout(currentSaveTimer.current);
    };
  }, [attachedTranslation, editorLocked, selectedId, transcript]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT" || target?.tagName === "SELECT") {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      }
      if (event.key === "ArrowLeft") seekBy(-5);
      if (event.key === "ArrowRight") seekBy(5);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  function seekTo(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(seconds, duration || seconds));
    setCurrentTime(audio.currentTime);
  }

  function seekBy(delta: number) {
    seekTo((audioRef.current?.currentTime ?? 0) + delta);
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    const start = parseTime(rangeStart) ?? 0;
    const end = parseTime(rangeEnd);
    if (audio.paused && end !== null && end > start && audio.currentTime >= end - 0.05) {
      audio.currentTime = start;
      setCurrentTime(start);
    }
    if (audio.paused) void audio.play();
    else audio.pause();
  }

  function stop() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    seekTo(parseTime(rangeStart) ?? 0);
  }

  function updateSegment(id: string, patch: Partial<Segment>) {
    if (!transcript || editorLocked) return;
    setTranscript({
      ...transcript,
      segments: transcript.segments.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment))
    });
  }

  function mutateSegments(mutator: (segments: Segment[]) => Segment[]) {
    if (!transcript || editorLocked) return;
    setUndoSnapshot(transcript);
    setTranscript({ ...transcript, segments: mutator(transcript.segments) });
  }

  function newSegment(start: number, end: number): Segment {
    return {
      id: `seg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      start: Math.max(0, start),
      end: Math.max(0, end),
      text: "",
      translation: "",
    };
  }

  function addSegmentAfter(segmentId: string) {
    mutateSegments((segments) => {
      const index = segments.findIndex((segment) => segment.id === segmentId);
      if (index < 0) return segments;
      const current = segments[index];
      const next = segments[index + 1];
      const start = current.end;
      const end = next ? Math.max(start, next.start) : start + 2;
      return [...segments.slice(0, index + 1), newSegment(start, end), ...segments.slice(index + 1)];
    });
  }

  function deleteSegment(segmentId: string) {
    mutateSegments((segments) => segments.filter((segment) => segment.id !== segmentId));
  }

  function splitSegment(segmentId: string) {
    mutateSegments((segments) => {
      const index = segments.findIndex((segment) => segment.id === segmentId);
      if (index < 0) return segments;
      const current = segments[index];
      if (currentTime <= current.start || currentTime >= current.end) return segments;

      const caretIndex = textCaret?.segmentId === segmentId ? textCaret.index : null;
      const leftText = caretIndex === null ? current.text : current.text.slice(0, caretIndex).trim();
      const rightText = caretIndex === null ? "" : current.text.slice(caretIndex).trim();
      const left: Segment = { ...current, end: currentTime, text: leftText };
      const right: Segment = {
        ...current,
        id: `seg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        start: currentTime,
        text: rightText,
        translation: "",
      };
      return [...segments.slice(0, index), left, right, ...segments.slice(index + 1)];
    });
  }

  function canSplitSegment(segment: Segment): boolean {
    return currentTime > segment.start && currentTime < segment.end;
  }

  function mergeWithNext(segmentId: string) {
    mutateSegments((segments) => {
      const index = segments.findIndex((segment) => segment.id === segmentId);
      if (index < 0 || index >= segments.length - 1) return segments;
      const current = segments[index];
      const next = segments[index + 1];
      const merged: Segment = {
        ...current,
        end: next.end,
        text: [current.text, next.text].filter(Boolean).join(" ").trim(),
        translation: [current.translation, next.translation].filter(Boolean).join("\n").trim(),
      };
      return [...segments.slice(0, index), merged, ...segments.slice(index + 2)];
    });
  }

  function updateSegmentTime(segmentId: string, field: "start" | "end", value: string) {
    const parsed = parseTime(value);
    if (parsed === null) return;
    updateSegment(segmentId, { [field]: parsed });
  }

  function undoLastSegmentEdit() {
    if (!undoSnapshot || editorLocked) return;
    setTranscript(undoSnapshot);
    setUndoSnapshot(null);
  }

  async function createSavePoint() {
    if (!selectedId || !transcript || editorLocked) return;
    try {
      setSnapshotState("Sauvegarde...");
      const nextRecovery = await api.createSnapshot(selectedId, transcriptWithoutTranslations(transcript));
      if (attachedTranslation) {
        await api.createTranslationSnapshot(selectedId, translationFromTranscript(transcript, attachedTranslation));
      }
      const history = await api.snapshots(selectedId);
      setRecovery(nextRecovery?.needs_resolution ? nextRecovery : null);
      setSnapshots(history);
      setSelectedSnapshotId("");
      setPreviewTranscript(null);
      setPreviewSnapshot(null);
      setRestoreConfirm(false);
      setShowPreviewDiff(false);
      setSnapshotState("Sauvegardé");
      setError("");
    } catch (err) {
      setSnapshotState("Sauvegarder");
      setError(err instanceof Error ? err.message : "Sauvegarde impossible");
    }
  }

  async function importTranslationContent(content: string, filename: string, replace: boolean) {
    if (!selectedId || !transcript) return;
    try {
      setTranslationState("Import traduction...");
      const imported = await api.importTranslation(selectedId, content, filename, replace);
      setAttachedTranslation(imported);
      setTranscript(applyTranslation(transcript, imported));
      setTranslationState("Traduction attachée");
      setPasteImportOpen(false);
      setPastedTranslation("");
      setError("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import de traduction impossible";
      if (!replace && message.includes("already exists")) {
        const shouldReplace = window.confirm("Une traduction existe déjà. La remplacer par ce fichier ?");
        if (shouldReplace) {
          await importTranslationContent(content, filename, true);
          return;
        }
      }
      setTranslationState(attachedTranslation ? "Traduction attachée" : "Aucune traduction");
      setError(message);
    }
  }

  async function importTranslationFile(file: File, replace: boolean) {
    try {
      await importTranslationContent(await file.text(), file.name, replace);
    } finally {
      if (translationFileRef.current) translationFileRef.current.value = "";
    }
  }

  async function importPastedTranslation() {
    if (!pastedTranslation.trim()) {
      setError("Colle une traduction Markdown avant d'importer.");
      return;
    }
    try {
      await importTranslationContent(pastedTranslation, "pasted-translation.md", false);
    } finally {
      if (translationFileRef.current) translationFileRef.current.value = "";
    }
  }

  async function copyTranslationPrompt() {
    if (!transcript || editorLocked) return;
    try {
      await navigator.clipboard.writeText(translationPromptFromTranscript(transcript));
      setCopyState("Copié");
      setError("");
      window.setTimeout(() => setCopyState("Copier prompt"), 1800);
    } catch (err) {
      setCopyState("Copier prompt");
      setError(err instanceof Error ? err.message : "Copie impossible");
    }
  }

  async function startExport() {
    if (!selectedId || !transcript || editorLocked) return;
    if (!attachedTranslation) {
      setError("Importe une traduction alignée avant de générer un MP4 sous-titré.");
      return;
    }
    try {
      setExportState("Préparation...");
      setExportJob(null);
      await api.saveCurrent(selectedId, transcriptWithoutTranslations(transcript));
      if (attachedTranslation) {
        await api.saveTranslation(selectedId, translationFromTranscript(transcript, attachedTranslation));
      }
      const job = await api.createVideoExport(selectedId);
      setExportJob(job);
      setExportState(job.status === "queued" ? "Export en file" : "Export vidéo");
      setError("");
    } catch (err) {
      setExportState("Export vidéo");
      setError(err instanceof Error ? err.message : "Export vidéo impossible");
    }
  }

  function resumeRecoveredWork() {
    setRecovery(null);
    setShowRecoveryDiff(false);
    setSnapshotState("Sauvegarder");
    setError("");
  }

  async function restoreSavePoint() {
    if (!selectedId) return;
    try {
      const loaded = await api.restoreSnapshot(selectedId);
      const history = await api.snapshots(selectedId);
      setTranscript(loaded.transcript);
      setRecovery(null);
      setSnapshots(history);
      setSelectedSnapshotId("");
      setPreviewTranscript(null);
      setPreviewSnapshot(null);
      setRestoreConfirm(false);
      setShowPreviewDiff(false);
      setUndoSnapshot(null);
      setShowRecoveryDiff(false);
      setSnapshotState("Restauré");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restauration impossible");
    }
  }

  async function selectHistoryVersion(snapshotId: string) {
    setSelectedSnapshotId(snapshotId);
    setRestoreConfirm(false);
    setShowPreviewDiff(false);
    if (!snapshotId) {
      setPreviewTranscript(null);
      setPreviewSnapshot(null);
      setError("");
      return;
    }
    if (!selectedId) return;
    try {
      const loaded = await api.snapshot(selectedId, snapshotId);
      setPreviewTranscript(loaded.transcript);
      setPreviewSnapshot(loaded.snapshot);
      setError("");
    } catch (err) {
      setSelectedSnapshotId("");
      setPreviewTranscript(null);
      setPreviewSnapshot(null);
      setRestoreConfirm(false);
      setShowPreviewDiff(false);
      setError(err instanceof Error ? err.message : "Sauvegarde impossible à charger");
    }
  }

  function returnToCurrentVersion() {
    setSelectedSnapshotId("");
    setPreviewTranscript(null);
    setPreviewSnapshot(null);
    setRestoreConfirm(false);
    setShowPreviewDiff(false);
    setError("");
  }

  async function restorePreviewSnapshot() {
    if (!selectedId || !previewSnapshot) return;
    try {
      const loaded = await api.restoreSnapshot(selectedId, previewSnapshot.id);
      const history = await api.snapshots(selectedId);
      setTranscript(loaded.transcript);
      setRecovery(null);
      setSnapshots(history);
      setSelectedSnapshotId("");
      setPreviewTranscript(null);
      setPreviewSnapshot(null);
      setRestoreConfirm(false);
      setShowPreviewDiff(false);
      setUndoSnapshot(null);
      setShowRecoveryDiff(false);
      setSnapshotState("Restauré");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restauration impossible");
    }
  }

  function syncRangeStart() {
    setRangeStart(formatTime(currentTime));
  }

  function syncRangeEnd() {
    setRangeEnd(formatTime(currentTime));
  }

  function onTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = audio.currentTime;
    setCurrentTime(nextTime);
    const end = parseTime(rangeEnd);
    const start = parseTime(rangeStart) ?? 0;
    if (loopEnabled && end !== null && end > start && nextTime >= end) {
      audio.currentTime = start;
      void audio.play();
      return;
    }
    if (!loopEnabled && end !== null && end > start && nextTime >= end) {
      audio.pause();
      audio.currentTime = end;
      setCurrentTime(end);
    }
  }

  function updateTimelineHover(event: React.PointerEvent<HTMLDivElement>) {
    const max = duration || selectedVideo?.duration_seconds || 0;
    if (!max) {
      setTimelineHover(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setTimelineHover({ time: ratio * max, x: ratio * 100 });
  }

  function scrollToCurrentSegment() {
    const segments = displayedTranscript?.segments;
    if (!segments?.length) return;
    const time = audioRef.current?.currentTime ?? currentTime;
    const target =
      segments.find((segment) => time >= segment.start && time < segment.end) ??
      [...segments].reverse().find((segment) => segment.start <= time) ??
      segments[0];
    const element = segmentRefs.current.get(target.id);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    setFocusedSegmentId(target.id);
    window.setTimeout(() => {
      setFocusedSegmentId((current) => (current === target.id ? "" : current));
    }, 1600);
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main>
      <header className="topbar">
        <div className="project-title">
          <span>Tarjama Studio</span>
          <small>{selectedVideo?.series ?? "Corpus"}</small>
        </div>

        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">Vidéo</option>
          {videos.map((video) => (
            <option key={video.corpus_id} value={video.corpus_id}>
              {video.episode ? `Ep ${video.episode} - ` : ""}
              {video.title}
            </option>
          ))}
        </select>

        <button
          className="save-button"
          disabled={!transcript || editorLocked}
          onClick={() => void createSavePoint()}
          title="Créer une sauvegarde"
        >
          <Save size={17} />
          <span>{snapshotState}</span>
        </button>
        <button
          className="theme-button"
          onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
          title={theme === "dark" ? "Mode clair" : "Mode sombre"}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      <section className="player-band">
        <audio
          ref={audioRef}
          src={selectedVideo?.audio_url}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? selectedVideo?.duration_seconds ?? 0)}
        />
        <div className="interval-row">
          <label>
            <span>Début</span>
            <input value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
            <button onClick={syncRangeStart} title="Prendre le temps courant comme début">
              <FileInput size={16} />
            </button>
          </label>
          <label>
            <span>Fin</span>
            <input value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
            <button onClick={syncRangeEnd} title="Prendre le temps courant comme fin">
              <FileInput size={16} />
            </button>
          </label>
          <label className="toggle">
            <input checked={loopEnabled} type="checkbox" onChange={(event) => setLoopEnabled(event.target.checked)} />
            <span>Boucle</span>
          </label>
        </div>
        <div
          className="timeline-wrap"
          onPointerMove={updateTimelineHover}
          onPointerLeave={() => setTimelineHover(null)}
        >
          {timelineHover ? (
            <div className="timeline-tooltip" style={{ left: `${timelineHover.x}%` }}>
              {formatTime(timelineHover.time)}
            </div>
          ) : null}
          <input
            className="timeline"
            type="range"
            min="0"
            max={duration || selectedVideo?.duration_seconds || 0}
            step="0.01"
            value={currentTime}
            onChange={(event) => seekTo(Number(event.target.value))}
          />
          <div className="timeline-readout">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration || selectedVideo?.duration_seconds || 0)}</span>
          </div>
        </div>
        <div className="audio-controls">
          <button onClick={() => seekBy(-10)} title="Reculer de 10 secondes">
            -10s
          </button>
          <button onClick={() => seekBy(-3)} title="Reculer de 3 secondes">
            -3s
          </button>
          <button className="primary-control" onClick={togglePlay} title={isPlaying ? "Pause" : "Lecture"}>
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            <span>{isPlaying ? "Pause" : "Lire"}</span>
          </button>
          <button onClick={stop} title="Stop">
            <Square size={16} />
            <span>Stop</span>
          </button>
          <button onClick={() => seekBy(3)} title="Avancer de 3 secondes">
            +3s
          </button>
          <button onClick={() => seekBy(10)} title="Avancer de 10 secondes">
            +10s
          </button>
          <button onClick={() => seekTo(parseTime(rangeStart) ?? 0)} title="Retour au début de l'intervalle">
            <RotateCcw size={16} />
            <span>Début</span>
          </button>
        </div>
        <div className="player-nav">
          <button disabled={!displayedTranscript} onClick={scrollToCurrentSegment} title="Aller au segment du temps courant">
            <LocateFixed size={16} />
            <span>Segment</span>
          </button>
          <button onClick={scrollToTop} title="Remonter en haut de la page">
            <ArrowUpToLine size={16} />
            <span>Haut</span>
          </button>
        </div>
      </section>

      {showRecoveryBanner && (
        <section className="recovery-banner">
          <div>
            <strong>Modifications non validées retrouvées</strong>
            <span>
              {recoverySummary.changed} modifié(s), {recoverySummary.added} ajouté(s), {recoverySummary.removed} supprimé(s)
            </span>
          </div>
          <div className="recovery-actions">
            <button onClick={() => setShowRecoveryDiff((value) => !value)}>
              <GitCompare size={16} />
              <span>Diff</span>
            </button>
            <button onClick={resumeRecoveredWork}>
              <Check size={16} />
              <span>Reprendre</span>
            </button>
            <button onClick={() => void restoreSavePoint()}>
              <RotateCcw size={16} />
              <span>Dernière sauvegarde</span>
            </button>
          </div>
          {showRecoveryDiff && (
            <div className="recovery-diff">
              {recoveryDiff.slice(0, 8).map((line) => (
                <article key={`${line.kind}-${line.id}`}>
                  <span>{formatTime(line.start)}</span>
                  <strong>
                    {line.kind === "added" ? "Ajout" : line.kind === "removed" ? "Suppression" : "Modification"}
                  </strong>
                  {line.before && <p dir="rtl">- {shortText(line.before)}</p>}
                  {line.after && <p dir="rtl">+ {shortText(line.after)}</p>}
                </article>
              ))}
              {recoveryDiff.length > 8 && <small>{recoveryDiff.length - 8} changement(s) non affiché(s)</small>}
            </div>
          )}
        </section>
      )}

      {historySnapshots.length > 0 && (
        <section className="snapshot-history">
          <div>
            <History size={16} />
            <strong>Historique</strong>
          </div>
          <select value={selectedSnapshotId} onChange={(event) => void selectHistoryVersion(event.target.value)}>
            <option value="">Choisir une sauvegarde</option>
            {historySnapshots.map((snapshot) => (
              <option key={snapshot.id} value={snapshot.id}>
                {snapshotLabel(snapshot)}
              </option>
            ))}
          </select>
        </section>
      )}

      {isHistoryPreview && previewSnapshot && (
        <section className="readonly-banner">
          <div>
            <strong>Ancienne sauvegarde en lecture seule</strong>
            <span>
              Vous consultez {snapshotLabel(previewSnapshot)}. Les modifications sont désactivées et la sauvegarde originale reste intacte.
            </span>
            <span>
              Écart avec la version courante : {previewSummary.changed} modifié(s), {previewSummary.added} ajouté(s),{" "}
              {previewSummary.removed} supprimé(s)
            </span>
          </div>
          <div className="readonly-actions">
            <button onClick={() => setShowPreviewDiff((value) => !value)}>
              <GitCompare size={16} />
              <span>Diff</span>
            </button>
            <button onClick={returnToCurrentVersion}>
              <X size={16} />
              <span>Version courante</span>
            </button>
            <button className="danger-button" onClick={() => setRestoreConfirm(true)}>
              <AlertTriangle size={16} />
              <span>Restaurer...</span>
            </button>
          </div>
          {showPreviewDiff && (
            <div className="version-diff">
              {previewDiff.slice(0, 30).map((line) => (
                <article key={`${line.kind}-${line.id}`}>
                  <span>{formatTime(line.start)}</span>
                  <strong>
                    {line.kind === "added" ? "Ajout courant" : line.kind === "removed" ? "Absent courant" : "Modification"}
                  </strong>
                  {line.before && <p dir="rtl">- {shortText(line.before, 180)}</p>}
                  {line.after && <p dir="rtl">+ {shortText(line.after, 180)}</p>}
                </article>
              ))}
              {previewDiff.length === 0 && <small>Aucun écart éditable avec la version courante.</small>}
              {previewDiff.length > 30 && <small>{previewDiff.length - 30} changement(s) non affiché(s)</small>}
            </div>
          )}
        </section>
      )}

      {restoreConfirm && previewSnapshot && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRestoreConfirm(false);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title">
            <h2 id="restore-title">Restaurer cette sauvegarde ?</h2>
            <p>
              La version courante sera remplacée par {snapshotLabel(previewSnapshot)}. Une copie de sécurité sera créée
              avant restauration.
            </p>
            <div className="modal-actions">
              <button onClick={() => setRestoreConfirm(false)}>Annuler</button>
              <button className="danger-button" onClick={() => void restorePreviewSnapshot()}>
                <Check size={16} />
                <span>Restaurer la sauvegarde</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {pasteImportOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPasteImportOpen(false);
          }}
        >
          <section className="modal paste-modal" role="dialog" aria-modal="true" aria-labelledby="paste-title">
            <h2 id="paste-title">Importer une traduction collée</h2>
            <p>Colle le Markdown complet renvoyé par ChatGPT. Les timestamps seront validés avant remplacement.</p>
            <textarea
              value={pastedTranslation}
              onChange={(event) => setPastedTranslation(event.target.value)}
              placeholder="# Translation&#10;&#10;source_corpus_id: ..."
            />
            <div className="modal-actions">
              <button onClick={() => setPasteImportOpen(false)}>Annuler</button>
              <button onClick={() => void importPastedTranslation()}>
                <Check size={16} />
                <span>Importer</span>
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="document-strip">
        {selectedVideo && (
          <div className="video-meta">
            <strong>{selectedVideo.title}</strong>
            <span>{formatTime(selectedVideo.duration_seconds ?? 0)}</span>
          </div>
        )}
        {loading && <p className="state">Chargement...</p>}
        {error && <p className="error">{error}</p>}
        {selectedVideo && !transcript && !loading && (
          <p className="state">Aucune transcription segmentée. Lance la CLI pour transcrire cette vidéo.</p>
        )}
        {transcript && (
          <div className="translation-tools">
            <span>{translationState}</span>
            <button disabled={editorLocked} onClick={() => void copyTranslationPrompt()}>
              <Copy size={16} />
              <span>{copyState}</span>
            </button>
            <button disabled={editorLocked} onClick={() => setPasteImportOpen(true)}>
              <ClipboardPaste size={16} />
              <span>Coller</span>
            </button>
            <input
              ref={translationFileRef}
              accept=".md,text/markdown,text/plain"
              className="hidden-file"
              type="file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importTranslationFile(file, false);
              }}
            />
            <button disabled={editorLocked} onClick={() => translationFileRef.current?.click()}>
              <Upload size={16} />
              <span>{attachedTranslation ? "Remplacer traduction" : "Importer traduction"}</span>
            </button>
          </div>
        )}
        {transcript && (
          <div className="export-tools">
            <span>{attachedTranslation ? "Traduction prête pour export" : "Importe une traduction pour exporter"}</span>
            <button
              disabled={
                editorLocked ||
                !selectedVideo?.has_video ||
                !attachedTranslation ||
                exportJob?.status === "queued" ||
                exportJob?.status === "running"
              }
              onClick={() => void startExport()}
              title={
                selectedVideo?.has_video
                  ? "Générer un MP4 sous-titré avec la traduction"
                  : "Vidéo source absente"
              }
            >
              <Download size={16} />
              <span>{exportState}</span>
            </button>
            {exportJob?.status === "running" || exportJob?.status === "queued" ? (
              <span>Rendu en cours...</span>
            ) : null}
            {exportJob?.status === "completed" && exportJob.media_url ? (
              <a href={exportJob.media_url} target="_blank" rel="noreferrer">
                Ouvrir
              </a>
            ) : null}
          </div>
        )}
        {undoSnapshot && (
          <button className="undo-button" disabled={editorLocked} onClick={undoLastSegmentEdit}>
            Annuler la dernière modification
          </button>
        )}
      </section>

      <section className="workspace">
        <section className="segments">
          {displayedTranscript?.segments.map((segment, index) => (
            <article
              className={`segment-row ${focusedSegmentId === segment.id ? "segment-row-focused" : ""}`}
              key={segment.id}
              ref={(element) => {
                if (element) segmentRefs.current.set(segment.id, element);
                else segmentRefs.current.delete(segment.id);
              }}
            >
              <div className="segment-meta">
                <label className="time-control time-control-nav">
                  <span>Lire</span>
                  <button className="timestamp" onClick={() => seekTo(segment.start)}>
                    {formatTime(segment.start)}
                  </button>
                </label>
                <label className="time-control">
                  <span>Début</span>
                  <input
                    className="time-input"
                    disabled={editorLocked}
                    value={formatTime(segment.start)}
                    onChange={(event) => updateSegmentTime(segment.id, "start", event.target.value)}
                    title="Début du segment"
                  />
                </label>
                <label className="time-control">
                  <span>Fin</span>
                  <input
                    className="time-input"
                    disabled={editorLocked}
                    value={formatTime(segment.end)}
                    onChange={(event) => updateSegmentTime(segment.id, "end", event.target.value)}
                    title="Fin du segment"
                  />
                </label>
              </div>
              <div className="segment-fields">
                <textarea
                  dir="rtl"
                  lang="ar"
                  disabled={editorLocked}
                  value={segment.text}
                  onSelect={(event) =>
                    setTextCaret({ segmentId: segment.id, index: event.currentTarget.selectionStart })
                  }
                  onFocus={(event) =>
                    setTextCaret({ segmentId: segment.id, index: event.currentTarget.selectionStart })
                  }
                  onChange={(event) => updateSegment(segment.id, { text: event.target.value })}
                />
                <textarea
                  disabled={editorLocked || !attachedTranslation}
                  value={segment.translation}
                  placeholder={attachedTranslation ? "Traduction" : "Importer une traduction alignée"}
                  onChange={(event) => updateSegment(segment.id, { translation: event.target.value })}
                />
                <div className="segment-actions">
                  <button disabled={editorLocked} onClick={() => addSegmentAfter(segment.id)} title="Ajouter un segment après">
                    <Plus size={16} />
                  </button>
                  <button
                    disabled={editorLocked || !canSplitSegment(segment)}
                    onClick={() => splitSegment(segment.id)}
                    title={
                      canSplitSegment(segment)
                        ? "Scinder au temps courant"
                        : "Place le temps courant strictement dans ce segment"
                    }
                  >
                    <Scissors size={16} />
                  </button>
                  <button
                    onClick={() => mergeWithNext(segment.id)}
                    disabled={editorLocked || index >= displayedSegmentCount - 1}
                    title="Fusionner avec le segment suivant"
                  >
                    <Combine size={16} />
                  </button>
                  <button disabled={editorLocked} onClick={() => deleteSegment(segment.id)} title="Supprimer le segment">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

function Root() {
  if (window.tarjamaDesktop) return <DesktopApp />;
  if (navigator.userAgent.includes("Electron")) {
    return (
      <main className="desktop-shell">
        <section className="desktop-panel">
          <h1>Initialisation desktop impossible</h1>
          <p className="error">
            L'API Electron n'a pas été chargée. Relance l'application après avoir reconstruit le desktop.
          </p>
        </section>
      </main>
    );
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
