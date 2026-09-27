import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { request, setCSRF, stageNames, type Project } from "./api";
import { purgeDrafts } from "./drafts";
import { Create } from "./Create";
import { Editor } from "./Editor";
import { Keys } from "./Keys";
import { canVisitStep, currentStep, parseRoute, projectPath } from "./routes";
import "./styles.css";
function App() {
  const pendingFile = useRef<{ id: string; file: File } | null>(null);
  const flush = useRef<(() => Promise<void>) | null>(null);
  const path = useRef(window.location.pathname);
  const navigation = useRef(0);
  const changingRoute = useRef(false);
  const observedProject = useRef<Project | null>(null);
  const keysReturn = useRef("/projets");
  const [route, setRoute] = useState(path.current);
  const [routeLoading, setRouteLoading] = useState(false);
  const [user, setUser] = useState(""),
    [loaded, setLoaded] = useState(false),
    [dev, setDev] = useState(false),
    [projects, setProjects] = useState<Project[]>([]),
    [selected, setSelected] = useState<Project | null>(null),
    [error, setError] = useState("");
  const routeInfo = parseRoute(route);
  const view = routeInfo.view;
  const userRef = useRef(user);
  userRef.current = user;
  const [archiving, setArchiving] = useState("");
  const [registration, setRegistration] = useState(false);
  const visibleProjects = projects.filter(
    (p) => Boolean(p.archived) === (view === "archives"),
  );

  async function archiveProject(project: Project) {
    if (archiving) return;
    setArchiving(project.id);
    setError("");
    try {
      const updated = await request<Project>(
        `/api/projects/${project.id}/archive`,
        "PATCH",
        { archived: !project.archived },
      );
      setProjects((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setArchiving("");
    }
  }

  function commitPath(next: string, mode: "push" | "replace") {
    if (window.location.pathname !== next || mode === "replace") {
      window.history[mode === "push" ? "pushState" : "replaceState"](
        {},
        "",
        next,
      );
    }
    path.current = next;
    setRoute(next);
  }
  async function go(next: string, mode: "push" | "replace" = "push") {
    const version = ++navigation.current;
    const previous = path.current;
    changingRoute.current = true;
    try {
      await flush.current?.();
      if (version !== navigation.current) return;
    } catch (e) {
      if (version !== navigation.current) return;
      // popstate has already moved the URL. Restore the edited page if save fails.
      if (window.location.pathname !== previous) commitPath(previous, "push");
      changingRoute.current = false;
      setError(
        "Navigation interrompue : vos modifications n’ont pas pu être enregistrées.",
      );
      return;
    }
    setError("");
    setRouteLoading(true);
    try {
      const target = parseRoute(next);
      if (target.view === "project") {
        const { project } = await request<{ project: Project }>(
          `/api/projects/${target.id}`,
        );
        if (version !== navigation.current) return;
        const canonical = projectPath(
          project,
          canVisitStep(project, target.step)
            ? target.step
            : currentStep(project),
        );
        observedProject.current = project;
        setSelected(project);
        if (target.step && next !== canonical) {
          setError(
            "Cette étape n’est pas disponible. Le projet est ouvert à son étape actuelle.",
          );
        }
        commitPath(canonical, mode);
      } else {
        const list = await request<Project[]>("/api/projects");
        if (version !== navigation.current) return;
        setProjects(list);
        setSelected(null);
        commitPath(next === "/" ? "/projets" : next, mode);
      }
    } catch {
      if (version !== navigation.current) return;
      setSelected(null);
      commitPath(next, mode);
      setError(
        "Impossible d’ouvrir cette page. Vérifiez votre connexion et l’accès au projet.",
      );
    } finally {
      if (version === navigation.current) {
        changingRoute.current = false;
        setRouteLoading(false);
      }
    }
  }
  async function session() {
    try {
      const s = await request<{ id: string; csrf: string }>("/api/session");
      setCSRF(s.csrf);
      setUser(s.id);
      let destination = window.location.pathname;
      try {
        const saved = sessionStorage.getItem("tarjama:return-path");
        sessionStorage.removeItem("tarjama:return-path");
        if (
          destination === "/" &&
          saved &&
          parseRoute(saved).view !== "missing"
        )
          destination = saved;
      } catch {
        /* Private browsers can disable storage. */
      }
      await go(destination, "replace");
    } catch {
      setUser("");
    } finally {
      setLoaded(true);
    }
  }
  const navigateRef = useRef(go);
  navigateRef.current = go;
  useEffect(() => {
    const expired = () => {
      navigation.current++;
      changingRoute.current = false;
      setRouteLoading(false);
      if (userRef.current)
        setError(
          "Votre session a expiré. Reconnectez-vous pour continuer ; vos brouillons sont conservés sur cet appareil.",
        );
      setUser("");
      setSelected(null);
    };
    window.addEventListener("tarjama:session-expired", expired);
    void request<{ development: boolean; registration?: boolean }>("/api/config")
      .then((c) => { setDev(c.development); setRegistration(Boolean(c.registration)); })
      .catch(() => {});
    void session();
    const onPop = () => {
      if (window.location.pathname !== path.current)
        void navigateRef.current(window.location.pathname, "replace");
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("tarjama:session-expired", expired);
    };
  }, []);
  function syncProject(project: Project) {
    if (changingRoute.current || parseRoute(path.current).id !== project.id)
      return;
    const viewed = parseRoute(path.current).step;
    const previous = observedProject.current;
    observedProject.current = project;
    setSelected(project);
    // Follow a workflow transition only from its current page. Someone reading
    // an earlier page stays there when a background job finishes.
    if (
      !canVisitStep(project, viewed) ||
      (previous &&
        previous.stage !== project.stage &&
        viewed === currentStep(previous))
    ) {
      const canonical = projectPath(project);
      if (path.current !== canonical) commitPath(canonical, "replace");
    }
  }
  async function logout() {
    try {
      await flush.current?.();
      const result = await request<{logout_url?: string} | undefined>("/api/logout", "POST");
      navigation.current++;
      purgeDrafts();
      pendingFile.current = null;
      setCSRF("");
      setUser("");
      setProjects([]);
      setSelected(null);
      setError("");
      setRouteLoading(false);
      changingRoute.current = false;
      commitPath("/projets", "replace");
      if (result?.logout_url) window.location.assign(result.logout_url);
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
        <a
          className="primary button"
          href="/sign-in"
          onClick={() => {
            try {
              sessionStorage.setItem(
                "tarjama:return-path",
                window.location.pathname,
              );
            } catch {
              /* Optional return location. */
            }
          }}
        >
          Se connecter
        </a>
        {registration && <>
          <a className="button" href="/sign-up">Créer mon compte</a>
          <p>Pas de validation ni de récupération par email. En cas de perte d’accès, contactez le propriétaire du service.</p>
        </>}
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
        <button className="brand" onClick={() => void go("/projets")}>
          تَرْجَمَة <span>Tarjama</span>
        </button>
        <nav>
          <button
            onClick={() => {
              if (view === "keys") void go(keysReturn.current);
              else {
                keysReturn.current = path.current;
                void go("/compte/cles");
              }
            }}
          >
            Mes clés
          </button>
          <button onClick={() => void logout()}>Déconnexion</button>
        </nav>
      </header>
      <main>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {routeLoading ? (
          <p role="status">Chargement…</p>
        ) : view === "keys" ? (
          <Keys close={() => void go(keysReturn.current)} />
        ) : view === "project" && selected ? (
          <Editor
            key={selected.id}
            initial={selected}
            step={
              canVisitStep(selected, routeInfo.step)
                ? routeInfo.step
                : currentStep(selected)
            }
            navigateStep={(step) => go(projectPath(selected, step))}
            initialFile={
              pendingFile.current?.id === selected.id
                ? pendingFile.current.file
                : null
            }
            consumeFile={() => {
              pendingFile.current = null;
            }}
            user={user}
            back={() => go("/projets")}
            register={(fn) => {
              flush.current = fn;
            }}
            onProjectChange={syncProject}
          />
        ) : view === "missing" || view === "project" ? (
          <section>
            <h1>Page indisponible</h1>
            <button onClick={() => void go("/projets")}>← Mes projets</button>
          </section>
        ) : (
          <>
            <div className="page-title">
              <div>
                <p className="eyebrow">VOTRE ESPACE PRIVÉ</p>
                <h1>Mes projets</h1>
                <p>Une vidéo. Une écoute attentive. Des mots fidèles.</p>
              </div>
              <button
                className="primary"
                onClick={() => void go("/projets/nouveau")}
              >
                + Nouvelle vidéo
              </button>
            </div>
            {view === "create" && (
              <Create
                onClose={() => void go("/projets")}
                onOpen={(id) => void go(`/projets/${encodeURIComponent(id)}`)}
                onCreate={(p, file) => {
                  pendingFile.current = file ? { id: p.id, file } : null;
                  void go(projectPath(p));
                }}
              />
            )}
            <nav
              className="tabs library-tabs"
              aria-label="Classement des projets"
            >
              <button
                aria-pressed={view !== "archives"}
                onClick={() => void go("/projets")}
              >
                Projets actifs ({projects.filter((p) => !p.archived).length})
              </button>
              <button
                aria-pressed={view === "archives"}
                onClick={() => void go("/projets/archives")}
              >
                Archives ({projects.filter((p) => p.archived).length})
              </button>
            </nav>
            {visibleProjects.length === 0 ? (
              <section className="empty">
                <h2>
                  {view === "archives"
                    ? "Aucun projet archivé"
                    : "Votre première vidéo commence ici"}
                </h2>
                <p>
                  {view === "archives"
                    ? "Les projets archivés conservent leur vidéo et leurs sous-titres. Vous pouvez les restaurer à tout moment."
                    : "Collez un lien YouTube ou importez une vidéo depuis votre appareil."}
                </p>
                <button onClick={() => void go("/projets/nouveau")}>
                  Nouvelle vidéo
                </button>
              </section>
            ) : (
              <div className="projects">
                {visibleProjects.map((p) => (
                  <article
                    className="project-card"
                    key={p.id}
                    aria-label={p.title}
                  >
                    <button
                      className="project"
                      onClick={() =>
                        void go(`/projets/${encodeURIComponent(p.id)}`)
                      }
                    >
                      <span className="project-icon">▶</span>
                      <strong>{p.title}</strong>
                      <span>{stageNames[p.stage]}</span>
                    </button>
                    <button
                      className="project-archive"
                      disabled={Boolean(archiving)}
                      onClick={() => void archiveProject(p)}
                      aria-label={
                        p.archived
                          ? "Restaurer le projet"
                          : "Archiver le projet"
                      }
                    >
                      {p.archived ? "Restaurer" : "Archiver"}
                    </button>
                  </article>
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
