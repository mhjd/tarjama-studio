const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,159}$/;
const SNAPSHOT_ID_PATTERN = /^[a-zA-Z0-9_.-]{1,240}\.json$/;

export function assertSafeProjectId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) {
    throw new Error("Identifiant de projet invalide");
  }
}

export function assertSafeSnapshotId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SNAPSHOT_ID_PATTERN.test(value) || value.includes("..")) {
    throw new Error("Identifiant de sauvegarde invalide");
  }
}

export function safeRemoteUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) {
    throw new Error("Lien vidéo invalide");
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Le lien vidéo doit être une URL HTTP ou HTTPS valide");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Le lien vidéo doit utiliser HTTP ou HTTPS sans identifiants intégrés");
  }
  return parsed.toString();
}

export function safeFormatSelector(value: unknown, allowed: readonly string[], fallback: string): string {
  const selected = typeof value === "string" && value ? value : fallback;
  if (!allowed.includes(selected)) {
    throw new Error("Format vidéo invalide ou périmé; analyse à nouveau les formats disponibles");
  }
  return selected;
}

export function isLoopbackDevServer(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function mediaProjectIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "media") return null;
  assertSafeProjectId(parts[1]);
  return parts[1];
}

export function safeRendererAssetPath(root: string, pathname: string): string {
  if (pathname.includes("\0") || pathname.includes("\\")) throw new Error("Chemin d'interface invalide");
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Chemin d'interface hors application");
  }
  return target;
}
import path from "node:path";
