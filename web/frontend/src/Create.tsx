import { useState } from "react";
import { APIError, request, type Project } from "./api";
export function Create({
  onClose,
  onCreate,
  onOpen,
}: {
  onClose: () => void;
  onCreate: (p: Project, file: File | null) => void;
  onOpen: (id: string) => void;
}) {
  const [mode, setMode] = useState<"link" | "file">("link"),
    [title, setTitle] = useState(""),
    [url, setURL] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [existingProject, setExistingProject] = useState("");
  function clearError() {
    setError("");
    setExistingProject("");
  }
  async function create() {
    setBusy(true);
    clearError();
    try {
      const p = await request<Project>("/api/projects", "POST", {
        title: title.trim() || file?.name || "Nouvelle vidéo",
        url: mode === "link" ? url : "",
      });
      onCreate(p, mode === "file" ? file : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (
        e instanceof APIError &&
        e.status === 409 &&
        e.code === "duplicate_video"
      ) {
        setExistingProject(e.projectId);
      }
    } finally {
      setBusy(false);
    }
  }
  // Pass the selected file via a short-lived in-memory slot so mounting order cannot lose it.
  return (
    <section className="panel">
      <div className="row">
        <h2>Nouvelle vidéo</h2>
        <button onClick={onClose} aria-label="Fermer">
          ×
        </button>
      </div>
      <div className="tabs">
        <button
          disabled={busy}
          aria-pressed={mode === "link"}
          onClick={() => {
            setMode("link");
            clearError();
          }}
        >
          Coller un lien
        </button>
        <button
          disabled={busy}
          aria-pressed={mode === "file"}
          onClick={() => {
            setMode("file");
            clearError();
          }}
        >
          Importer une vidéo
        </button>
      </div>
      <label>
        Titre
        <input
          value={title}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={300}
        />
      </label>
      {mode === "link" ? (
        <label>
          Lien YouTube
          <input
            type="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            disabled={busy}
            onChange={(e) => {
              setURL(e.target.value);
              clearError();
            }}
          />
        </label>
      ) : (
        <label>
          Vidéo de votre appareil
          <input
            type="file"
            disabled={busy}
            accept="video/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
            }}
          />
          <small>
            1 Go et 3 heures maximum. Gardez cette page ouverte pendant l’envoi.
          </small>
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      {existingProject ? (
        <button className="primary" onClick={() => onOpen(existingProject)}>
          Ouvrir le projet existant
        </button>
      ) : (
        <button
          className="primary"
          disabled={busy || (mode === "link" ? !url : !file)}
          onClick={() => void create()}
        >
          {busy ? "Création…" : "Commencer"}
        </button>
      )}
    </section>
  );
}
