import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpToLine,
  Check,
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
  Scissors,
  Settings,
  Square,
  Sun,
  Trash2,
  Upload,
  X
} from "lucide-react";
import "./styles.css";

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
type DesktopView = "library" | "editor" | "options";
type DesktopActionMenu = "transcription" | "translation" | "export" | null;

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
format: ashrafent-translation-v1

## 00:00.000 --> 00:03.440
Traduction française du bloc.

Transcription à traduire:

# Source

source_corpus_id: ${transcript.corpus_id}

${sourceBlocks}
`;
}

function DesktopApp() {
  const desktop = window.ashrafentDesktop;
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
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeFormats, setYoutubeFormats] = useState<YoutubeFormatOption[]>([]);
  const [selectedYoutubeFormat, setSelectedYoutubeFormat] = useState("");
  const [youtubeFormatTitle, setYoutubeFormatTitle] = useState("");
  const [youtubeFormatProjectId, setYoutubeFormatProjectId] = useState("");
  const [youtubeCreateWarning, setYoutubeCreateWarning] = useState("");
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
    () => (localStorage.getItem("ashrafent-theme") === "light" ? "light" : "dark"),
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rangeStart, setRangeStart] = useState("00:00");
  const [rangeEnd, setRangeEnd] = useState("00:00");
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pasteImportOpen, setPasteImportOpen] = useState(false);
  const [pastedTranslation, setPastedTranslation] = useState("");
  const [cleanupImportOpen, setCleanupImportOpen] = useState(false);
  const [pastedCleanupTranscript, setPastedCleanupTranscript] = useState("");
  const [cleanupCopyState, setCleanupCopyState] = useState("Copier le prompt de nettoyage");
  const [renameProjectOpen, setRenameProjectOpen] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [copyState, setCopyState] = useState("Copier prompt");
  const [exportingTrack, setExportingTrack] = useState<ExportTrack | null>(null);
  const [exportSubtitleStyle, setExportSubtitleStyle] = useState<ExportSubtitleStyle>("black-band");
  const [openActionMenu, setOpenActionMenu] = useState<DesktopActionMenu>(null);
  const [saveState, setSaveState] = useState("Sauvegarder");
  const [timelineHover, setTimelineHover] = useState<{ time: number; x: number } | null>(null);
  const [focusedSegmentId, setFocusedSegmentId] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const segmentRefs = useRef(new Map<string, HTMLElement>());
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
    void desktop?.groqKeyStatus().then(setGroqKeyStatus).catch(() => undefined);
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
    localStorage.setItem("ashrafent-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!openActionMenu) return;
    function onPointerDown(event: PointerEvent) {
      if (!actionMenusRef.current?.contains(event.target as Node)) {
        setOpenActionMenu(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenActionMenu(null);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
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
    setBusy(true);
    setState(label);
    setError("");
    try {
      await action();
      await refreshLibrary();
      setState("Prêt");
    } catch (err) {
      setState("Erreur");
      setError(err instanceof Error ? err.message : "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  async function importTranscriptDesktop(project: DesktopProject) {
    if (!project.videoPath) {
      setError("Ajoute d'abord une vidéo avant d'importer une transcription.");
      return;
    }
    await runDesktopAction("Import transcription...", async () => {
      const result = await desktop?.importTranscript(project.id);
      if (result) {
        setState(`Transcription importée: ${result.segmentCount} segments`);
        setSelectedProjectId(project.id);
        setDesktopView("editor");
        await loadDesktopProject(project.id);
      }
    });
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
    if (!groqKeyStatus.configured) {
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
    await runDesktopAction("Transcription Groq...", async () => {
      const loaded = await desktop.transcribeWithGroq(project.id);
      applyLoadedProject(loaded);
      setGroqProgress({ projectId: project.id, stage: "done", percent: 100, message: "Transcription Groq terminée" });
    });
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
    if (!desktop || !selectedProjectId) return;
    await runDesktopAction("Import du nettoyage...", async () => {
      const result = await desktop.importCleanedTranscriptFile(selectedProjectId);
      if (result) applyCleanedTranscriptResult(result);
    });
  }

  async function importCleanedTranscriptContentDesktop() {
    if (!desktop || !selectedProjectId || !pastedCleanupTranscript.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await desktop.importCleanedTranscriptContent(selectedProjectId, pastedCleanupTranscript);
      applyCleanedTranscriptResult(result);
      setPastedCleanupTranscript("");
      setCleanupImportOpen(false);
      await refreshLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import du nettoyage impossible");
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

  function returnToLibrary() {
    if (
      desktopView === "options" &&
      (cleanupPromptChanged || translationPromptChanged) &&
      !window.confirm("Des modifications de prompt ne sont pas enregistrées. Quitter Options et les abandonner ?")
    ) return;
    audioRef.current?.pause();
    setDesktopView("library");
    setPreviewTranscript(null);
    setPreviewSnapshot(null);
    setSelectedSnapshotId("");
    window.scrollTo({ top: 0 });
  }

  async function createYoutubeProjectDesktop() {
    const url = youtubeUrl.trim();
    if (!url) {
      setError("Colle un lien YouTube avant de créer le projet.");
      return;
    }
    await runDesktopAction("Création du projet...", async () => {
      const result = await desktop?.createYoutubeProject({ url });
      if (!result) return;
      setYoutubeUrl("");
      setYoutubeFormats([]);
      setSelectedYoutubeFormat("");
      setYoutubeFormatTitle("");
      setYoutubeFormatProjectId("");
      setYoutubeCreateWarning(result.warning ?? "");
      setSelectedProjectId(result.project.id);
      setDesktopView("editor");
      setState(result.warning ? "Projet créé avec avertissement" : "Projet créé. Tu peux maintenant ajouter la vidéo.");
    });
  }

  async function downloadYoutubeDesktop(project: DesktopProject) {
    const url = project.youtubeUrl?.trim() ?? "";
    if (!url) {
      setError("Ce projet n'a pas de lien YouTube.");
      return;
    }
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
    const confirmed = window.confirm(`Déplacer le projet "${project.title}" à la corbeille ?`);
    if (!confirmed) return;
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

  function stopAudio() {
    audioRef.current?.pause();
    seekTo(parseTime(rangeStart) ?? 0);
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

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateSegment(id: string, patch: Partial<Segment>) {
    if (!transcript || editorLocked) return;
    setTranscript({
      ...transcript,
      segments: transcript.segments.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)),
    });
  }

  function mutateSegments(mutator: (segments: Segment[]) => Segment[]) {
    if (!transcript || editorLocked) return;
    setTranscript({ ...transcript, segments: mutator(transcript.segments) });
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
    if (!desktop || !selectedProjectId || !transcript || editorLocked) return;
    setSaveState("Sauvegarde...");
    setError("");
    try {
      applyLoadedProject(await desktop.createTranscriptSnapshot(selectedProjectId, transcript));
      setSaveState("Sauvegardé");
    } catch (err) {
      setSaveState("Sauvegarder");
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
    setError("");
    try {
      const result = await desktop.importTranslationFile(selectedProjectId);
      if (result) {
        setAttachedTranslation(result.translation);
        if (transcript) setTranscript(applyTranslation(transcript, result.translation));
        await loadDesktopProject(selectedProjectId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import traduction impossible");
    }
  }

  async function importPastedTranslationDesktop() {
    if (!desktop || !selectedProjectId || !pastedTranslation.trim()) return;
    if (!loadedProjectHasVideo) {
      setError("Ajoute d'abord une vidéo avant d'importer une traduction.");
      return;
    }
    setError("");
    try {
      const result = await desktop.importTranslationContent(selectedProjectId, pastedTranslation, "pasted-translation.md", true);
      setAttachedTranslation(result.translation);
      if (transcript) setTranscript(applyTranslation(transcript, result.translation));
      setPastedTranslation("");
      setPasteImportOpen(false);
      await loadDesktopProject(selectedProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import traduction impossible");
    }
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
    setExportProgress(null);
    setError("");
    setState(track === "arabic" ? "Préparation de l'export arabe..." : "Préparation de l'export traduction...");
    try {
      await desktop.saveCurrentTranscript(selectedProjectId, transcriptWithoutTranslations(transcript));
      if (attachedTranslation) {
        await desktop.saveTranslation(selectedProjectId, translationFromTranscript(transcript, attachedTranslation));
      }
      setState("Choisis l'emplacement du fichier exporté...");
      const result = await desktop.exportVideo(selectedProjectId, track, openAfter, exportSubtitleStyle);
      if (result) {
        setState(result.opened ? `Export créé et ouvert: ${result.outputPath}` : `Export créé: ${result.outputPath}`);
        setExportProgress(null);
      } else {
        setState("Export annulé.");
        setExportProgress(null);
      }
    } catch (err) {
      setState("Export échoué.");
      setError(err instanceof Error ? err.message : "Export impossible");
      setExportProgress(null);
    } finally {
      setExportingTrack(null);
    }
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
          <button disabled={busy || !project.videoPath} onClick={() => void importTranscriptDesktop(project)}>
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
      <div className="download-progress" role="status" aria-live="polite">
        <div>
          <span>{downloadProgress.message}</span>
          {downloadProgress.percent !== undefined && <strong>{downloadProgress.percent.toFixed(1)}%</strong>}
        </div>
        <progress value={downloadProgress.percent ?? undefined} max="100" />
        <small>
          {[downloadProgress.speed, downloadProgress.eta ? `ETA ${downloadProgress.eta}` : ""].filter(Boolean).join(" · ")}
        </small>
      </div>
    );
  }

  function renderExportProgress() {
    if (!exportProgress || exportProgress.stage === "done") return null;
    return (
      <div className="download-progress export-progress" role="status" aria-live="polite">
        <div>
          <span>{exportProgress.message}</span>
          {exportProgress.percent !== undefined && <strong>{exportProgress.percent.toFixed(1)}%</strong>}
        </div>
        <progress value={exportProgress.percent ?? undefined} max="100" />
        <small>{exportProgress.eta ? `ETA ${exportProgress.eta}` : "Rendu en cours..."}</small>
      </div>
    );
  }

  function renderGroqProgress() {
    if (!groqProgress || groqProgress.stage === "done") return null;
    return (
      <div className="download-progress" role="status" aria-live="polite">
        <div>
          <span>{groqProgress.message}</span>
          {groqProgress.percent !== undefined && <strong>{groqProgress.percent.toFixed(1)}%</strong>}
        </div>
        <progress value={groqProgress.percent ?? undefined} max="100" />
        <small>
          {groqProgress.chunkIndex && groqProgress.chunkCount
            ? `Morceau ${groqProgress.chunkIndex} sur ${groqProgress.chunkCount}`
            : "Préparation de l'audio..."}
        </small>
      </div>
    );
  }

  return (
    <main className="desktop-shell">
      <header className={`desktop-header ${desktopView !== "library" ? "desktop-header-editor" : ""}`}>
        {desktopView === "editor" ? (
          <>
            <button className="back-button" onClick={returnToLibrary}>
              <ArrowLeft size={16} />
              <span>Projets</span>
            </button>
            <div>
              <strong dir="auto">{loadedProject?.title ?? "Projet"}</strong>
              <span>{loadedProject ? projectStatusLabel(loadedProject) : "Chargement"}</span>
            </div>
            <button disabled={!loadedProject || busy} onClick={openRenameProject} title="Renommer le projet">
              <Pencil size={16} />
              <span>Renommer</span>
            </button>
          </>
        ) : desktopView === "options" ? (
          <>
            <button className="back-button" onClick={returnToLibrary}>
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
            <strong>Ashrafent Reviewer</strong>
            <span>Bibliothèque locale</span>
          </div>
        )}
        {desktopView === "library" && (
          <>
            <button disabled={busy} onClick={() => void refreshLibrary()}>
              <RotateCcw size={16} />
              <span>Actualiser</span>
            </button>
            <button onClick={() => setDesktopView("options")}>
              <Settings size={16} />
              <span>Options</span>
            </button>
          </>
        )}
      </header>

      {desktopView === "library" && (
        <>
          <section className="desktop-panel">
            <h1>Créer un projet</h1>
            <div className="desktop-actions">
              <label>
                <span>Lien YouTube</span>
                <input
                  value={youtubeUrl}
                  onChange={(event) => {
                    setYoutubeUrl(event.target.value);
                    setYoutubeFormats([]);
                    setSelectedYoutubeFormat("");
                    setYoutubeFormatTitle("");
                    setYoutubeFormatProjectId("");
                    setYoutubeCreateWarning("");
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </label>
              <div className="desktop-create-buttons">
                <button disabled={busy} onClick={() => void createYoutubeProjectDesktop()}>
                  <Plus size={16} />
                  <span>Créer projet</span>
                </button>
              </div>
            </div>
            {youtubeCreateWarning && <p className="warning">{youtubeCreateWarning}</p>}
            <p className="desktop-state">{state}</p>
            {renderDownloadProgress()}
            {downloadProgress?.stage === "done" && (
              <p className="desktop-state">Téléchargement terminé. Le projet a été ajouté à la liste.</p>
            )}
            {error && <p className="error">{error}</p>}
            {library && <p className="desktop-path">{library.libraryDir}</p>}
          </section>

          <section className="desktop-projects">
            <h2>Projets</h2>
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
                    ? "Une clé personnelle est enregistrée dans le coffre chiffré du système."
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
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {desktopView === "editor" && !loadedProject && (
        <section className="desktop-panel">
          <p className="state">{busy ? "Chargement du projet..." : "Aucun projet ouvert."}</p>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {desktopView === "editor" && loadedProject && (
        <section className="desktop-editor">
          <div className="document-strip">
            <div className="video-meta">
              <strong>{loadedProject.title}</strong>
              <span>{formatTime(duration || loadedProject.durationSeconds || 0)}</span>
            </div>
            <div className="document-actions" ref={actionMenusRef}>
              <button disabled={!transcript || editorLocked} onClick={() => void createSavePointDesktop()}>
                <Save size={16} />
                <span>{saveState}</span>
              </button>

              <div className={`action-menu ${openActionMenu === "transcription" ? "open" : ""}`}>
                <button
                  className="action-menu-trigger"
                  onClick={() => setOpenActionMenu((value) => (value === "transcription" ? null : "transcription"))}
                >
                  <span>Transcription</span>
                </button>
                {openActionMenu === "transcription" && (
                  <div className="action-menu-content">
                    <button
                      disabled={busy || isHistoryPreview || !loadedProjectHasVideo}
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
                  onClick={() => setOpenActionMenu((value) => (value === "translation" ? null : "translation"))}
                >
                  <span>Traduction</span>
                </button>
                {openActionMenu === "translation" && (
                  <div className="action-menu-content">
                    <button
                      disabled={!transcript || editorLocked}
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
                  onClick={() => setOpenActionMenu((value) => (value === "export" ? null : "export"))}
                >
                  <span>Exporter</span>
                </button>
                {openActionMenu === "export" && (
                  <div className="action-menu-content">
                    <label className="subtitle-style-picker">
                      <span>Style sous-titres</span>
                      <select
                        value={exportSubtitleStyle}
                        onChange={(event) => setExportSubtitleStyle(event.target.value as ExportSubtitleStyle)}
                      >
                        <option value="black-band">Fond noir</option>
                        <option value="outline">Texte seul</option>
                      </select>
                    </label>
                    <button
                      disabled={!transcript || editorLocked || !loadedProjectHasVideo || Boolean(exportingTrack)}
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
          {error && <pre className="error import-error">{error}</pre>}

          <section className="media-tools">
            <div>
              <strong>Vidéo</strong>
              <span>
                {loadedProject.videoPath
                  ? "Vidéo disponible"
                  : loadedProject.youtubeUrl
                    ? "Ajoute la vidéo depuis YouTube ou depuis ton ordinateur avant transcription, traduction ou export."
                    : "Importe une vidéo avant transcription, traduction ou export."}
              </span>
            </div>
            <div className="media-tool-actions">
              <button disabled={busy || !loadedProject.youtubeUrl} onClick={() => void analyzeYoutubeFormatsDesktop(loadedProject)}>
                <RotateCcw size={16} />
                <span>Choisir la qualité à télécharger</span>
              </button>
              <button disabled={busy} onClick={() => void importLocalVideoDesktop(loadedProject)}>
                <FileInput size={16} />
                <span>{loadedProject.videoPath ? "Remplacer par une vidéo locale" : "Importer une vidéo locale"}</span>
              </button>
            </div>
            {loadedProject.youtubeUrlWarning && <p className="warning">{loadedProject.youtubeUrlWarning}</p>}
            {youtubeFormats.length > 0 && youtubeFormatProjectId === loadedProject.id && (
              <div className="youtube-download-choice">
                <label className="youtube-format-picker">
                  <span>{youtubeFormatTitle ? `Qualité à télécharger pour ${youtubeFormatTitle}` : "Qualité à télécharger"}</span>
                  <select value={selectedYoutubeFormat} onChange={(event) => setSelectedYoutubeFormat(event.target.value)}>
                    {youtubeFormats.map((format) => (
                      <option key={format.id} value={format.formatSelector}>
                        {format.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={busy || !selectedYoutubeFormat} onClick={() => void downloadYoutubeDesktop(loadedProject)}>
                  <Download size={16} />
                  <span>{loadedProject.videoPath ? "Remplacer depuis YouTube" : "Télécharger depuis YouTube"}</span>
                </button>
              </div>
            )}
            {busy && <p className="desktop-state">{state}</p>}
            {renderDownloadProgress()}
            {downloadProgress?.stage === "done" && (
              <p className="desktop-state">Téléchargement terminé. La vidéo est attachée au projet.</p>
            )}
          </section>

          {mediaUrl && (
            <section className="player-band">
              <audio
                ref={audioRef}
                src={mediaUrl}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? loadedProject.durationSeconds ?? 0)}
              />
              <div className="interval-row">
                <label>
                  <span>Début</span>
                  <input value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
                  <button onClick={() => setRangeStart(formatTime(currentTime))}>
                    <FileInput size={16} />
                  </button>
                </label>
                <label>
                  <span>Fin</span>
                  <input value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
                  <button onClick={() => setRangeEnd(formatTime(currentTime))}>
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
              <div className="audio-controls">
                <button onClick={() => seekBy(-10)}>-10s</button>
                <button onClick={() => seekBy(-3)}>-3s</button>
                <button className="primary-control" onClick={togglePlay}>
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                  <span>{isPlaying ? "Pause" : "Lire"}</span>
                </button>
                <button onClick={stopAudio}>
                  <Square size={16} />
                  <span>Stop</span>
                </button>
                <button onClick={() => seekBy(3)}>+3s</button>
                <button onClick={() => seekBy(10)}>+10s</button>
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
          {displayedTranscript && (
            <section className="workspace">
              <section className="segments">
                {displayedTranscript.segments.map((segment, index) => (
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
                    <div className="segment-fields">
                      <textarea
                        dir="rtl"
                        lang="ar"
                        disabled={editorLocked}
                        value={segment.text}
                        onChange={(event) => updateSegment(segment.id, { text: event.target.value })}
                      />
                      <textarea
                        disabled={editorLocked || !attachedTranslation}
                        value={segment.translation}
                        placeholder={attachedTranslation ? "Traduction" : "Importer une traduction alignée"}
                        onChange={(event) => updateSegment(segment.id, { translation: event.target.value })}
                      />
                      <div className="segment-actions">
                        <button disabled={editorLocked} onClick={() => addSegmentAfter(segment.id)}>
                          <Plus size={16} />
                        </button>
                        <button
                          disabled={editorLocked || currentTime <= segment.start || currentTime >= segment.end}
                          onClick={() => splitSegment(segment.id)}
                        >
                          <Scissors size={16} />
                        </button>
                        <button disabled={editorLocked || index >= displayedTranscript.segments.length - 1} onClick={() => mergeWithNext(segment.id)}>
                          <Combine size={16} />
                        </button>
                        <button disabled={editorLocked} onClick={() => deleteSegment(segment.id)}>
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

      {pasteImportOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal paste-modal" role="dialog" aria-modal="true">
            <h2>Importer une traduction collée</h2>
            <p>Colle une traduction Ashrafent en Markdown. Les timestamps seront validés avant remplacement.</p>
            <textarea
              value={pastedTranslation}
              onChange={(event) => setPastedTranslation(event.target.value)}
              placeholder={'## 00:00.000 --> 00:03.440\nTraduction française.'}
            />
            {error && <pre className="error import-error">{error}</pre>}
            <div className="modal-actions">
              <button onClick={() => setPasteImportOpen(false)}>Annuler</button>
              <button disabled={!pastedTranslation.trim()} onClick={() => void importPastedTranslationDesktop()}>
                <Check size={16} />
                <span>Importer</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {cleanupImportOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal paste-modal" role="dialog" aria-modal="true">
            <h2>Importer la transcription nettoyée</h2>
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
            {error && <pre className="error import-error">{error}</pre>}
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setCleanupImportOpen(false)}>Annuler</button>
              <button
                disabled={busy || !cleanedPasteReview.valid}
                onClick={() => void importCleanedTranscriptContentDesktop()}
              >
                <Check size={16} />
                <span>Valider et importer</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {renameProjectOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setRenameProjectOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-project-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="rename-project-title">Renommer le projet</h2>
            <p>Ce titre sert uniquement à identifier le projet dans ta bibliothèque.</p>
            <input
              autoFocus
              maxLength={200}
              value={projectTitleDraft}
              onChange={(event) => setProjectTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenameProjectOpen(false);
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
          </section>
        </div>
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
          <span>Ashrafent</span>
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
  if (window.ashrafentDesktop) return <DesktopApp />;
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
