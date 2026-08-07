import type {
  ExportCueGrouping,
  ExportSubtitleSize,
  ExportVideoOptions,
  ExportVideoQuality,
} from "./types.js";

export type ExportCue = {
  start: number;
  end: number;
  text: string;
};

export type VideoDimensions = {
  width: number;
  height: number;
};

export const DEFAULT_EXPORT_OPTIONS: ExportVideoOptions = {
  style: "black-band",
  subtitleSize: "standard",
  videoQuality: "mobile-720p",
  cueGrouping: "automatic",
};

const SUBTITLE_SIZE_FACTORS: Record<ExportSubtitleSize, number> = {
  compact: 0.85,
  standard: 1,
  large: 1.15,
};

const QUALITY_SHORT_EDGE: Record<Exclude<ExportVideoQuality, "original">, number> = {
  "mobile-720p": 720,
  "compact-480p": 480,
};

const MINIMUM_SUBTITLE_DURATION_SECONDS = 5 / 6;
const MAXIMUM_SUBTITLE_DURATION_SECONDS = 7;
const MAXIMUM_GAP_SECONDS = 0.5;
const MAXIMUM_CHARACTERS_PER_SECOND = 17;
const MAXIMUM_TWO_LINE_CHARACTERS = 84;

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

export function normalizeExportOptions(value?: Partial<ExportVideoOptions> | null): ExportVideoOptions {
  const style = isOneOf(value?.style, ["black-band", "outline"] as const)
    ? value.style
    : DEFAULT_EXPORT_OPTIONS.style;
  const subtitleSize = isOneOf(value?.subtitleSize, ["compact", "standard", "large"] as const)
    ? value.subtitleSize
    : DEFAULT_EXPORT_OPTIONS.subtitleSize;
  const videoQuality = isOneOf(value?.videoQuality, ["original", "mobile-720p", "compact-480p"] as const)
    ? value.videoQuality
    : DEFAULT_EXPORT_OPTIONS.videoQuality;
  const cueGrouping = isOneOf(value?.cueGrouping, ["source", "automatic", "minimum-words"] as const)
    ? value.cueGrouping
    : DEFAULT_EXPORT_OPTIONS.cueGrouping;
  const requestedMinimum = Number(value?.minimumWords);
  const minimumWords = cueGrouping === "minimum-words"
    ? Math.max(2, Math.min(30, Number.isFinite(requestedMinimum) ? Math.round(requestedMinimum) : 10))
    : undefined;
  return { style, subtitleSize, videoQuality, cueGrouping, minimumWords };
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function outputDimensions(source: VideoDimensions, quality: ExportVideoQuality): VideoDimensions {
  const width = Math.max(2, Math.round(source.width));
  const height = Math.max(2, Math.round(source.height));
  if (quality === "original") return { width: even(width), height: even(height) };
  const maximumShortEdge = QUALITY_SHORT_EDGE[quality];
  const shortEdge = Math.min(width, height);
  if (shortEdge <= maximumShortEdge) return { width: even(width), height: even(height) };
  const scale = maximumShortEdge / shortEdge;
  return { width: even(width * scale), height: even(height * scale) };
}

export function subtitleFontSize(dimensions: VideoDimensions, size: ExportSubtitleSize): number {
  const shortEdge = Math.min(dimensions.width, dimensions.height);
  return Math.max(18, Math.round(shortEdge * 0.0667 * SUBTITLE_SIZE_FACTORS[size]));
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

function characterCount(text: string): number {
  return Array.from(text.normalize("NFC").trim()).length;
}

function canMerge(left: ExportCue, right: ExportCue): boolean {
  const gap = right.start - left.end;
  if (gap < -0.01 || gap > MAXIMUM_GAP_SECONDS) return false;
  const duration = right.end - left.start;
  if (duration <= 0 || duration > MAXIMUM_SUBTITLE_DURATION_SECONDS) return false;
  const text = `${left.text.trim()} ${right.text.trim()}`.trim();
  const characters = characterCount(text);
  if (characters > MAXIMUM_TWO_LINE_CHARACTERS) return false;
  return characters / duration <= MAXIMUM_CHARACTERS_PER_SECOND;
}

function needsMerge(cue: ExportCue, mode: ExportCueGrouping, minimumWords?: number): boolean {
  if (mode === "source") return false;
  if (mode === "minimum-words") return wordCount(cue.text) < (minimumWords ?? 10);
  return wordCount(cue.text) <= 2 || cue.end - cue.start < MINIMUM_SUBTITLE_DURATION_SECONDS;
}

export function groupExportCues(
  input: ExportCue[],
  mode: ExportCueGrouping,
  minimumWords?: number,
): ExportCue[] {
  const cues = input
    .filter((cue) => cue.text.trim() && cue.end > cue.start)
    .map((cue) => ({ ...cue, text: cue.text.trim() }));
  if (mode === "source") return cues;
  const grouped: ExportCue[] = [];
  for (let index = 0; index < cues.length; index += 1) {
    let current = { ...cues[index] };
    while (
      index + 1 < cues.length
      && needsMerge(current, mode, minimumWords)
      && canMerge(current, cues[index + 1])
    ) {
      const next = cues[index + 1];
      current = {
        start: current.start,
        end: next.end,
        text: `${current.text} ${next.text}`,
      };
      index += 1;
    }
    if (needsMerge(current, mode, minimumWords) && grouped.length > 0) {
      const previous = grouped[grouped.length - 1];
      if (canMerge(previous, current)) {
        grouped[grouped.length - 1] = {
          start: previous.start,
          end: current.end,
          text: `${previous.text} ${current.text}`,
        };
        continue;
      }
    }
    grouped.push(current);
  }
  return grouped;
}

export function videoEncodingArguments(quality: ExportVideoQuality): string[] {
  if (quality === "original") return ["-crf", "23", "-c:a", "aac", "-b:a", "128k"];
  if (quality === "mobile-720p") return ["-crf", "26", "-c:a", "aac", "-b:a", "96k"];
  return ["-crf", "29", "-c:a", "aac", "-b:a", "72k"];
}
