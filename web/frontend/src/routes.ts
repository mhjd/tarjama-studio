import type { Project } from "./api";

export const projectSteps: Record<string, string> = {
  upload: "preparer",
  preparing: "preparer",
  transcribing: "preparer",
  cleaning: "preparer",
  arabic: "corriger",
  translating: "traduire",
  review: "traduire",
  ready: "exporter",
};
export function projectPath(project: Project) {
  return `/projets/${encodeURIComponent(project.id)}/${projectSteps[project.stage] || "preparer"}`;
}
export function parseRoute(path: string): {
  view: "projects" | "create" | "keys" | "project" | "missing";
  id?: string;
  step?: string;
} {
  if (path === "/" || path === "/projets") return { view: "projects" };
  if (path === "/projets/nouveau") return { view: "create" };
  if (path === "/compte/cles") return { view: "keys" };
  const match = /^\/projets\/([a-zA-Z0-9_-]+)(?:\/([a-z-]+))?$/.exec(path);
  return match
    ? { view: "project", id: match[1], step: match[2] }
    : { view: "missing" };
}
