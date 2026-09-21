import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { request, setCSRF, stageNames, type Project } from "./api";
import { purgeDrafts } from "./drafts";
import { Create } from "./Create";
import { Editor } from "./Editor";
import { Keys } from "./Keys";
import "./styles.css";
function App() {
  const pendingFile = useRef<File | null>(null);
  const [user, setUser] = useState(""),
    [loaded, setLoaded] = useState(false),
    [dev, setDev] = useState(false),
    [projects, setProjects] = useState<Project[]>([]),
    [selected, setSelected] = useState<Project | null>(null),
    [creating, setCreating] = useState(false),
    [settings, setSettings] = useState(false),
    [error, setError] = useState("");
  async function session() {
    try {
      const s = await request<{ id: string; csrf: string }>("/api/session");
      setCSRF(s.csrf);
      setUser(s.id);
      setProjects(await request<Project[]>("/api/projects"));
    } catch {
      setUser("");
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    void request<{ development: boolean }>("/api/config").then((c) =>
      setDev(c.development),
    );
    void session();
  }, []);
  async function refresh() {
    setProjects(await request<Project[]>("/api/projects"));
    setSelected(null);
  }
  const [flush, setFlush] = useState<(() => Promise<void>) | null>(null);
  async function navigate(fn: () => void | Promise<void>) {
    try {
      await flush?.();
      await fn();
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  if (!loaded)
    return (
      <main>
        <p>Chargement…</p>
      </main>
    );
  if (!user)
    return (
      <main className="login">
        <span className="brand">تَرْجَمَة · Tarjama</span>
        <h1>
          De la parole arabe
          <br />
          aux sous-titres français.
        </h1>
        <p>
          Écoutez, corrigez et traduisez vos vidéos dans votre espace privé.
        </p>
        <a className="primary button" href="/auth/login">
          Se connecter
        </a>
        {dev && (
          <section>
            <p>Environnement de développement local</p>
            {["alice", "bob"].map((name) => (
              <button
                key={name}
                onClick={() =>
                  void request("/auth/development", "POST", { user: name })
                    .then(session)
                    .catch((e) => setError(String(e)))
                }
              >
                Compte test {name}
              </button>
            ))}
          </section>
        )}
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <>
      <header>
        <button className="brand" onClick={() => void navigate(refresh)}>
          تَرْجَمَة <span>Tarjama</span>
        </button>
        <nav>
          <button
            onClick={() =>
              void navigate(() => {
                setSettings(!settings);
              })
            }
          >
            Mes clés
          </button>
          <button
            onClick={() =>
              void navigate(async () => {
                await request("/api/logout", "POST");
                purgeDrafts();
                setCSRF("");
                setUser("");
                setSelected(null);
              })
            }
          >
            Déconnexion
          </button>
        </nav>
      </header>
      <main>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {settings ? (
          <Keys close={() => setSettings(false)} />
        ) : selected ? (
          <Editor
            key={selected.id}
            initial={selected}
            initialFile={pendingFile.current}
            consumeFile={() => {
              pendingFile.current = null;
            }}
            user={user}
            back={refresh}
            register={(fn) => setFlush(() => fn)}
          />
        ) : (
          <>
            <div className="page-title">
              <div>
                <p className="eyebrow">VOTRE ESPACE PRIVÉ</p>
                <h1>Mes projets</h1>
                <p>Une vidéo. Une écoute attentive. Des mots fidèles.</p>
              </div>
              <button className="primary" onClick={() => setCreating(true)}>
                + Nouvelle vidéo
              </button>
            </div>
            {creating && (
              <Create
                onClose={() => setCreating(false)}
                onCreate={(p, file) => {
                  pendingFile.current = file;
                  setSelected(p);
                  setCreating(false);
                }}
              />
            )}
            {projects.length === 0 ? (
              <section className="empty">
                <h2>Votre première vidéo commence ici</h2>
                <p>
                  Collez un lien YouTube ou importez une vidéo depuis votre
                  appareil.
                </p>
                <button onClick={() => setCreating(true)}>
                  Nouvelle vidéo
                </button>
              </section>
            ) : (
              <div className="projects">
                {projects.map((p) => (
                  <button
                    className="project"
                    key={p.id}
                    onClick={() =>
                      void request<{ project: Project }>(
                        `/api/projects/${p.id}`,
                      )
                        .then((x) => setSelected(x.project))
                        .catch((e) => setError(String(e)))
                    }
                  >
                    <span className="project-icon">▶</span>
                    <strong>{p.title}</strong>
                    <span>{stageNames[p.stage]}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>
      <footer>Tarjama Studio · Arabe → Français</footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
