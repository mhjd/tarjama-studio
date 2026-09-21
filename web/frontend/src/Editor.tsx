import { useEffect, useRef, useState } from "react";
import {
  request,
  upload,
  stageNames,
  time,
  type Project,
  type Segment,
  type Job,
  type Field,
} from "./api";
import { Drafts } from "./drafts";
export function Editor({
  initial,
  user,
  back,
  register,
  initialFile,
  consumeFile,
}: {
  initialFile: File | null;
  consumeFile: () => void;
  initial: Project;
  user: string;
  back: () => Promise<void>;
  register: (fn: (() => Promise<void>) | null) => void;
}) {
  const [, render] = useState(0);
  const draft = useRef<Drafts | null>(null);
  if (!draft.current)
    draft.current = new Drafts(initial, user, () => render((n) => n + 1));
  const d = draft.current,
    p = d.project;
  const [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [current, setCurrent] = useState(0),
    [playing, setPlaying] = useState(false),
    [follow, setFollow] = useState(true),
    [focused, setFocused] = useState(false),
    [track, setTrack] = useState("fr"),
    [quality, setQuality] = useState("low"),
    [title, setTitle] = useState(p.title),
    [replace, setReplace] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false);
  const media = useRef<HTMLVideoElement>(null),
    fields = useRef(new Map<string, HTMLTextAreaElement>()),
    composing = useRef(new Set<string>()),
    compositionWaiters = useRef<Array<() => void>>([]),
    mounted = useRef(true);
  async function refresh() {
    const x = await request<{ project: Project; jobs: Job[] }>(
      `/api/projects/${p.id}`,
    );
    if (!mounted.current) return;
    setJobs(x.jobs);
    if (!d.dirty) d.adopt(x.project);
  }
  async function flush() {
    if (composing.current.size)
      await new Promise<void>((resolve) =>
        compositionWaiters.current.push(resolve),
      );
    for (const [key, el] of fields.current) {
      const [id, field] = key.split(":");
      d.edit(id, field as Field, el.value);
    }
    await d.flush();
  }
  useEffect(() => {
    register(flush);
    const timer = setInterval(() => void refresh().catch(() => {}), 2000);
    void refresh().catch((e) => setError(String(e)));
    if (initialFile) {
      const f = initialFile;
      consumeFile();
      void sendFile(f);
    }
    return () => {
      mounted.current = false;
      clearInterval(timer);
      register(null);
    };
  }, []);
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await flush();
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function sendFile(file: File) {
    if (file.size > 1024 * 1024 * 1024) {
      setError("La vidéo dépasse 1 Go.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      d.adopt(await upload(p.id, file));
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }
  const active = p.segments.find(
    (s) => current * 1000 >= s.start_ms && current * 1000 < s.end_ms,
  )?.id;
  useEffect(() => {
    if (follow && !focused && active)
      document
        .getElementById(`segment-${active}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, follow, focused]);
  function seek(delta: number) {
    const v = media.current;
    if (v)
      v.currentTime = Math.max(
        0,
        Math.min(v.duration || 0, v.currentTime + delta),
      );
  }
  const editable = ["arabic", "review", "ready"].includes(p.stage),
    french = p.stage === "review" || p.stage === "ready";
  function field(s: Segment, f: Field) {
    const key = `${s.id}:${f}`;
    return (
      <label key={key} className={f}>
        <span>{f === "arabic" ? "Arabe" : "Français"}</span>
        <textarea
          aria-label={`${f === "arabic" ? "Arabe" : "Français"} ${s.id}`}
          lang={f === "arabic" ? "ar" : "fr"}
          dir={f === "arabic" ? "rtl" : "ltr"}
          rows={3}
          ref={(el) => {
            if (el) fields.current.set(key, el);
            else fields.current.delete(key);
          }}
          value={d.value(s.id, f)}
          disabled={!editable || busy}
          onFocus={() => setFocused(true)}
          onChange={(e) => d.edit(s.id, f, e.target.value)}
          onCompositionStart={() => composing.current.add(key)}
          onCompositionEnd={(e) => {
            d.edit(s.id, f, e.currentTarget.value);
            composing.current.delete(key);
            if (composing.current.size === 0) {
              for (const resolve of compositionWaiters.current) resolve();
              compositionWaiters.current = [];
            }
            if (document.activeElement !== e.currentTarget)
              void d.flush(key).catch(() => {});
          }}
          onBlur={(e) => {
            setFocused(false);
            d.edit(s.id, f, e.currentTarget.value);
            if (!composing.current.has(key)) void d.flush(key).catch(() => {});
          }}
        />
      </label>
    );
  }
  return (
    <>
      <button className="back" onClick={() => void action(back)}>
        ← Mes projets
      </button>
      <div className="page-title">
        <div>
          <p className="eyebrow">{stageNames[p.stage]}</p>
          <input
            className="project-title"
            aria-label="Titre du projet"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title !== p.title)
                void request<Project>(`/api/projects/${p.id}`, "PATCH", {
                  title,
                })
                  .then((x) => d.adopt(x))
                  .catch((e) => setError(String(e)));
            }}
          />
        </div>
        <small role="status">{d.status}</small>
      </div>
      <ol className="steps">
        {["Préparer", "Corriger", "Traduire", "Exporter"].map((s, i) => (
          <li
            className={
              i ===
              (["upload", "preparing", "transcribing", "cleaning"].includes(
                p.stage,
              )
                ? 0
                : p.stage === "arabic"
                  ? 1
                  : p.stage === "ready"
                    ? 3
                    : 2)
                ? "current"
                : ""
            }
            key={s}
          >
            <span>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      {(error || d.error) && (
        <section className="error" role="alert">
          <p>{error || d.error}</p>
          <p>Votre saisie reste dans ce navigateur.</p>
          <button onClick={() => void action(async () => {})}>Réessayer</button>
          {d.error.includes("autre fenêtre") && (
            <>
              <p>
                Relisez les valeurs actuelles du serveur avant de remplacer le
                texte par votre brouillon.
              </p>
              <button
                onClick={() =>
                  void request<{ project: Project }>(
                    `/api/projects/${p.id}`,
                  ).then((x) => {
                    setError(
                      x.project.segments
                        .map(
                          (s) =>
                            `${time(s.start_ms)} : ${s.arabic} / ${s.french}`,
                        )
                        .join("\n"),
                    );
                  })
                }
              >
                Voir le texte serveur
              </button>
              <button onClick={() => void d.resolve()}>
                Utiliser ma saisie comme nouvelle modification
              </button>
            </>
          )}
        </section>
      )}
      {!p.media && (
        <section className="panel">
          <h2>{uploading ? "Envoi de la vidéo…" : "Ajouter votre vidéo"}</h2>
          <p>
            Vous pouvez importer un fichier ici, même si le téléchargement du
            lien est en attente.
          </p>
          <label className="button">
            Importer la vidéo depuis mon appareil
            <input
              disabled={uploading}
              type="file"
              accept="video/*"
              onChange={(e) => {
                if (e.target.files?.[0]) void sendFile(e.target.files[0]);
              }}
            />
          </label>
          {uploading && (
            <p role="status">
              Gardez cette page ouverte jusqu’à la fin de l’envoi.
            </p>
          )}
        </section>
      )}
      {jobs
        .filter((j) => !["succeeded", "cancelled"].includes(j.state))
        .map((j) => (
          <section className="job" key={j.id}>
            <p>
              {j.message ||
                {
                  download: "Téléchargement vidéo",
                  prepare: "Vérification de la vidéo",
                  transcribe: "Transcription",
                  cleanup: "Nettoyage arabe",
                  translate: "Traduction",
                }[j.kind] ||
                "Création de la vidéo sous-titrée"}
            </p>
            <small>
              {j.state === "waiting_provider"
                ? "En attente — reprise automatique"
                : j.state === "failed"
                  ? "Intervention nécessaire"
                  : `${j.progress}% des morceaux terminés`}
            </small>
            {j.state === "failed" || j.state === "waiting_provider" ? (
              <button
                onClick={() =>
                  void action(async () => {
                    await request(
                      `/api/projects/${p.id}/jobs/${j.id}/retry`,
                      "POST",
                    );
                  })
                }
              >
                Réessayer
              </button>
            ) : (
              <button
                onClick={() =>
                  void action(async () => {
                    await request(
                      `/api/projects/${p.id}/jobs/${j.id}/cancel`,
                      "POST",
                    );
                  })
                }
              >
                Annuler
              </button>
            )}
          </section>
        ))}
      {jobs
        .filter((j) => j.state === "cancelled")
        .slice(-1)
        .map((j) => (
          <p key={j.id}>
            Traitement annulé.{" "}
            <button
              onClick={() =>
                void action(async () => {
                  await request(
                    `/api/projects/${p.id}/jobs/${j.id}/retry`,
                    "POST",
                  );
                })
              }
            >
              Reprendre
            </button>
          </p>
        ))}
      {p.media && (
        <section className="player">
          <video
            playsInline
            preload="metadata"
            ref={media}
            src={`/api/projects/${p.id}/media`}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <div className="player-controls">
            <button onClick={() => seek(-5)} aria-label="Reculer de 5 secondes">
              −5 s
            </button>
            <button
              className="primary"
              onClick={() => {
                const v = media.current;
                if (v)
                  void (v.paused ? v.play() : Promise.resolve(v.pause())).catch(
                    () => setError("Lecture impossible"),
                  );
              }}
            >
              {playing ? "Pause" : "Lecture"}
            </button>
            <button onClick={() => seek(5)} aria-label="Avancer de 5 secondes">
              +5 s
            </button>
            <span>
              {time(current * 1000)} / {time(p.duration_ms)}
            </span>
            <input
              aria-label="Position de lecture"
              type="range"
              min={0}
              max={p.duration_ms / 1000 || 1}
              step={0.1}
              value={current}
              onChange={(e) => {
                if (media.current)
                  media.current.currentTime = Number(e.target.value);
              }}
            />
          </div>
        </section>
      )}
      {p.segments.length > 0 && (
        <>
          <div className="row">
            <h2>{french ? "Relire arabe et français" : "Correction arabe"}</h2>
            {!follow && (
              <button
                onClick={() => {
                  setFollow(true);
                  document
                    .getElementById(`segment-${active}`)
                    ?.scrollIntoView({ block: "nearest" });
                }}
              >
                Suivre l’écoute
              </button>
            )}
          </div>
          <p className="notice">
            Vérifiez les citations religieuses et leurs références. Elles ne
            sont pas vérifiées automatiquement ; les citations coraniques
            françaises ne sont pas certifiées Hamidullah.
          </p>
          {p.stage === "arabic" &&
            p.translation_source > 0 &&
            p.translation_source !== p.arabic_version && (
              <p className="notice">
                L’arabe a changé. La traduction précédente est conservée ; une
                nouvelle traduction remplacera les retouches françaises après
                votre confirmation.
              </p>
            )}
          <div
            className="segments"
            onWheel={() => setFollow(false)}
            onTouchMove={() => setFollow(false)}
          >
            {p.segments.map((s) => (
              <article
                id={`segment-${s.id}`}
                key={s.id}
                className={`segment ${s.id === active ? "active" : ""}`}
              >
                <button
                  className="timestamp"
                  onClick={() => {
                    if (media.current)
                      media.current.currentTime = s.start_ms / 1000;
                  }}
                >
                  {time(s.start_ms)} — {time(s.end_ms)}
                </button>
                <div className={french ? "fields bilingual" : "fields"}>
                  {field(s, "arabic")}
                  {french && field(s, "french")}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {p.stage === "arabic" && (
        <section className="next-step">
          {p.translation_source > 0 &&
            p.translation_source !== p.arabic_version && (
              <label>
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                />{" "}
                Je confirme le remplacement de la traduction française.
              </label>
            )}
          <button
            className="primary"
            disabled={
              busy ||
              (p.translation_source > 0 &&
                p.translation_source !== p.arabic_version &&
                !replace)
            }
            onClick={() =>
              void action(async () => {
                d.adopt(
                  await request<Project>(
                    `/api/projects/${p.id}/advance`,
                    "POST",
                    {
                      version: d.project.version,
                      stage: "arabic",
                      replace_translation: replace,
                    },
                  ),
                );
              })
            }
          >
            {p.translation_source === p.arabic_version
              ? "Terminer la correction arabe · Relire la traduction"
              : "Terminer la correction arabe · Traduire"}
          </button>
        </section>
      )}
      {p.stage === "review" && (
        <section className="next-step">
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                d.adopt(
                  await request<Project>(
                    `/api/projects/${p.id}/advance`,
                    "POST",
                    { version: d.project.version, stage: "review" },
                  ),
                );
              })
            }
          >
            Terminer la relecture
          </button>
        </section>
      )}
      {p.stage === "ready" && (
        <section className="panel">
          <h2>Votre vidéo sous-titrée</h2>
          <div className="row">
            <label>
              Sous-titres
              <select value={track} onChange={(e) => setTrack(e.target.value)}>
                <option value="fr">Français</option>
                <option value="ar">Arabe</option>
              </select>
            </label>
            <label>
              Qualité
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
              >
                <option value="low">Low · partage WhatsApp</option>
                <option value="high">High · YouTube</option>
              </select>
            </label>
          </div>
          <p>
            Low produit un fichier plus léger. La taille finale dépend de la
            durée.
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await request(`/api/projects/${p.id}/exports`, "POST", {
                  version: d.project.version,
                  track,
                  quality,
                });
              })
            }
          >
            Créer la vidéo
          </button>
          {jobs
            .filter(
              (j) =>
                j.kind.startsWith("export_") &&
                j.state === "succeeded" &&
                j.source_version === p.version,
            )
            .map((j) => (
              <p key={j.id}>
                <a href={`/api/projects/${p.id}/exports/${j.id}`} download>
                  Télécharger · {j.kind.endsWith("low") ? "Low" : "High"} ·{" "}
                  {j.kind.includes("_ar_") ? "arabe" : "français"}
                </a>
              </p>
            ))}
        </section>
      )}
      <section className="danger">
        {deleteOpen ? (
          <>
            <p>
              Supprimer ce projet, sa vidéo et ses traitements de votre espace ?
            </p>
            <button
              onClick={() =>
                void action(async () => {
                  await request(`/api/projects/${p.id}`, "DELETE");
                  d.clear();
                  await back();
                })
              }
            >
              Confirmer la suppression
            </button>
            <button onClick={() => setDeleteOpen(false)}>
              Garder le projet
            </button>
          </>
        ) : (
          <button onClick={() => setDeleteOpen(true)}>
            Supprimer le projet
          </button>
        )}
      </section>
    </>
  );
}
