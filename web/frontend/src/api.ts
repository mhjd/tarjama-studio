export type Segment = {
  id: string;
  start_ms: number;
  end_ms: number;
  arabic: string;
  french: string;
  version: number;
};
export type Project = {
  id: string;
  title: string;
  url?: string;
  stage: string;
  version: number;
  arabic_version: number;
  translation_source: number;
  duration_ms: number;
  media?: string;
  segments: Segment[];
};
export type Job = {
  id: string;
  kind: string;
  state: string;
  progress: number;
  message: string;
  next_attempt_at: string;
  source_version: number;
};
export type Field = "arabic" | "french";
export let csrf = "";
export function setCSRF(value: string) {
  csrf = value;
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? (undefined as T) : response.json();
}
export async function upload(project: string, file: File) {
  const response = await fetch(`/api/projects/${project}/media`, {
    method: "PUT",
    headers: { "X-CSRF-Token": csrf },
    body: file,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<Project>;
}
export const stageNames: Record<string, string> = {
  upload: "Ajouter la vidéo",
  preparing: "Préparation de la vidéo",
  transcribing: "Transcription arabe",
  cleaning: "Nettoyage de l’arabe",
  arabic: "Corriger l’arabe",
  translating: "Traduction en français",
  review: "Relire la traduction",
  ready: "Exporter la vidéo",
};
export function time(ms: number) {
  const s = Math.floor(ms / 1000);
  return (
    (s >= 3600 ? `${Math.floor(s / 3600)}:` : "") +
    `${Math.floor(s / 60) % 60}`.padStart(2, "0") +
    ":" +
    `${s % 60}`.padStart(2, "0")
  );
}
