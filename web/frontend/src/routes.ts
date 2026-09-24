import type { Project } from "./api";

export const steps = [
  { slug: "preparer", label: "Préparer" },
  { slug: "corriger", label: "Corriger" },
  { slug: "traduire", label: "Traduire" },
  { slug: "exporter", label: "Exporter" },
] as const;
export type ProjectStep = (typeof steps)[number]["slug"];

export const projectSteps: Record<string, ProjectStep> = {
  upload: "preparer",
  preparing: "preparer",
  transcribing: "preparer",
  cleaning: "preparer",
  arabic: "corriger",
  translating: "traduire",
  review: "traduire",
  ready: "exporter",
};
export function currentStep(project: Project): ProjectStep {
  return projectSteps[project.stage] || "preparer";
}
// The server stage is the authority, including after an edit invalidates a later
// stage. Merely visiting an earlier page never advances or rewinds the workflow.
export function canVisitStep(
  project: Project,
  step?: string,
): step is ProjectStep {
  const index = steps.findIndex((entry) => entry.slug === step);
  return (
    index >= 0 &&
    index <= steps.findIndex((entry) => entry.slug === currentStep(project))
  );
}
export function projectPath(
  project: Project,
  step: ProjectStep = currentStep(project),
) {
  return `/projets/${encodeURIComponent(project.id)}/${step}`;
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
