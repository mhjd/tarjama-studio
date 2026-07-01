import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Check,
  Combine,
  FileInput,
  GitCompare,
  History,
  Moon,
  Pause,
  Plus,
  Play,
  RotateCcw,
  Save,
  Scissors,
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
    if (!response.ok) throw new Error("Enregistrement de traduction impossible");
  },
  async createTranslationSnapshot(corpusId: string, translation: Translation): Promise<void> {
    const response = await fetch(`/api/videos/${corpusId}/translation/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ translation })
    });
    if (!response.ok) throw new Error("Sauvegarde de traduction impossible");
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
  const [undoSnapshot, setUndoSnapshot] = useState<Transcript | null>(null);
  const [textCaret, setTextCaret] = useState<{ segmentId: string; index: number } | null>(null);

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
    if (!restoreConfirm) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRestoreConfirm(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [restoreConfirm]);

  useEffect(() => {
    if (!transcript || !selectedId || editorLocked) return;
    if (currentSaveTimer.current) window.clearTimeout(currentSaveTimer.current);
    currentSaveTimer.current = window.setTimeout(() => {
      const jobs: Promise<unknown>[] = [api.saveCurrent(selectedId, transcriptWithoutTranslations(transcript))];
      if (attachedTranslation) {
        setTranslationState("Traduction enregistrement...");
        jobs.push(api.saveTranslation(selectedId, translationFromTranscript(transcript, attachedTranslation)));
      }
      Promise.all(jobs)
        .then(() => {
          if (attachedTranslation) setTranslationState("Traduction attachée");
        })
        .catch((err) => {
          if (attachedTranslation) setTranslationState("Traduction non alignée");
          setError(err instanceof Error ? err.message : "L'état courant n'a pas pu être enregistré");
        });
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

  async function importTranslationFile(file: File, replace: boolean) {
    if (!selectedId || !transcript) return;
    try {
      setTranslationState("Import traduction...");
      const content = await file.text();
      const imported = await api.importTranslation(selectedId, content, file.name, replace);
      setAttachedTranslation(imported);
      setTranscript(applyTranslation(transcript, imported));
      setTranslationState("Traduction attachée");
      setError("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import de traduction impossible";
      if (!replace && message.includes("already exists")) {
        const shouldReplace = window.confirm("Une traduction existe déjà. La remplacer par ce fichier ?");
        if (shouldReplace) {
          await importTranslationFile(file, true);
          return;
        }
      }
      setTranslationState(attachedTranslation ? "Traduction attachée" : "Aucune traduction");
      setError(message);
    } finally {
      if (translationFileRef.current) translationFileRef.current.value = "";
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
        {undoSnapshot && (
          <button className="undo-button" disabled={editorLocked} onClick={undoLastSegmentEdit}>
            Annuler la dernière modification
          </button>
        )}
      </section>

      <section className="workspace">
        <section className="segments">
          {displayedTranscript?.segments.map((segment, index) => (
            <article className="segment-row" key={segment.id}>
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
