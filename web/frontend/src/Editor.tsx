import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  ExternalLink,
} from "lucide-react";
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
import { JobProgress } from "./JobProgress";
import { canVisitStep, currentStep, steps, type ProjectStep } from "./routes";
const playbackSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const speedLabel = (value: number) => `${value.toLocaleString("fr-FR")}×`;

export function Editor({
  initial,
  user,
  back,
  register,
  initialFile,
  consumeFile,
  onProjectChange,
  step,
  navigateStep,
}: {
  step: ProjectStep;
  navigateStep: (step: ProjectStep) => Promise<void>;
  onProjectChange: (project: Project) => void;
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
  useEffect(() => {
    onProjectChange(p);
  }, [p.stage]);
  const [jobs, setJobs] = useState<Job[]>([]),
    [connectionLost, setConnectionLost] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [current, setCurrent] = useState(0),
    [seekVersion, setSeekVersion] = useState(0),
    [playing, setPlaying] = useState(false),
    [playbackRate, setPlaybackRate] = useState(1),
    [follow, setFollow] = useState(true),
    [focused, setFocused] = useState(false),
    [expanded, setExpanded] = useState(false),
    [quality, setQuality] = useState("low"),
    [title, setTitle] = useState(p.title),
    [replace, setReplace] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false),
    [copyNotice, setCopyNotice] = useState("");
  const titleField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleField.current;
    if (!el) return;
    const resize = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [title]);
  const media = useRef<HTMLVideoElement>(null),
    fields = useRef(new Map<string, HTMLTextAreaElement>()),
    composing = useRef(new Set<string>()),
    compositionWaiters = useRef<Array<() => void>>([]),
    mounted = useRef(true);
  useEffect(() => {
    // A workflow transition opens a new page, rather than leaving the reader
    // at the bottom of the old text. Pause follow/playback while changing pages.
    media.current?.pause();
    setPlaying(false);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [step]);
  async function refresh() {
    const x = await request<{ project: Project; jobs: Job[] }>(
      `/api/projects/${p.id}`,
    );
    if (!mounted.current) return;
    setConnectionLost(false);
    setJobs(x.jobs);
    if (!d.dirty) d.adopt(x.project);
  }
  const titleSave = useRef<Promise<void>>(Promise.resolve());
  function saveTitle() {
    const value = titleField.current?.value;
    const saved = titleSave.current
      .catch(() => {})
      .then(async () => {
        if (value === undefined || value === d.project.title) return;
        const updated = await request<Project>(
          `/api/projects/${p.id}`,
          "PATCH",
          { title: value },
        );
        // Renaming does not change content versions; do not replace newer segments.
        d.adopt({ ...d.project, title: updated.title });
      });
    titleSave.current = saved;
    return saved;
  }
  async function flush() {
    if (composing.current.size)
      await new Promise<void>((resolve) =>
        compositionWaiters.current.push(resolve),
      );
    await saveTitle();
    for (const [key, el] of fields.current) {
      const [id, field] = key.split(":");
      d.edit(id, field as Field, el.value);
    }
    await d.flush();
  }
  useEffect(() => {
    register(flush);
    const timer = setInterval(
      () =>
        void refresh().catch(() => {
          if (mounted.current) setConnectionLost(true);
        }),
      2000,
    );
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
    if (busy || uploading) return;
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
    if (
      follow &&
      !focused &&
      active &&
      (current > 0 || seekVersion > 0 || playing)
    )
      document
        .getElementById(`segment-${active}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, follow, focused, seekVersion]);
  function seekTo(seconds: number) {
    const v = media.current;
    if (!v) return;
    const position = Math.max(
      0,
      Math.min(v.duration || p.duration_ms / 1000, seconds),
    );
    v.currentTime = position;
    setCurrent(position);
    setSeekVersion((n) => n + 1);
  }
  function seek(delta: number) {
    if (media.current) seekTo(media.current.currentTime + delta);
  }
  function togglePlayback() {
    const v = media.current;
    if (v)
      void (v.paused ? v.play() : Promise.resolve(v.pause())).catch(() =>
        setError("Lecture impossible"),
      );
  }
  function changeSpeed(rate: number) {
    const v = media.current;
    if (!v) return;
    v.preservesPitch = true;
    v.playbackRate = Math.max(0.5, Math.min(2, rate));
    setPlaybackRate(v.playbackRate);
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement) || event.isComposing) return;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        target.isContentEditable ||
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="slider"]',
        )
      )
        return;
      if (event.shiftKey) {
        if (
          media.current &&
          (event.key === "ArrowUp" || event.key === "ArrowDown")
        ) {
          event.preventDefault();
          changeSpeed(
            media.current.playbackRate +
              (event.key === "ArrowUp" ? 0.25 : -0.25),
          );
        }
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (!media.current) return;
        event.preventDefault();
        seek(event.key === "ArrowLeft" ? -5 : 5);
      } else if (event.code === "Space" || event.key === " ") {
        // Preserve native keyboard activation and avoid a second toggle on keyup.
        if (
          !media.current ||
          target.closest(
            'button, a, summary, [role="button"], video[controls], audio[controls]',
          )
        )
          return;
        event.preventDefault();
        if (!event.repeat) togglePlayback();
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [p.duration_ms]);
  const editable = ["arabic", "review", "ready"].includes(p.stage),
    french =
      step !== "corriger" && (p.stage === "review" || p.stage === "ready");
  const translationPending = p.stage === "translating";
  const showSegments =
    step === "corriger" ||
    ((step === "traduire" || step === "exporter") && !translationPending);
  const showPlayer =
    Boolean(p.media) && !(step === "traduire" && translationPending);
  const validating =
    (step === "corriger" && p.stage === "arabic") ||
    (step === "traduire" && p.stage === "review");
  function visibleJob(job: Job) {
    if (job.kind === "translate")
      return step === "traduire" && translationPending;
    if (job.kind.startsWith("export_"))
      return step === "exporter" && job.source_version === p.version;
    return step === "preparer" && currentStep(p) === "preparer";
  }
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
  const sourceJobs = jobs.filter((j) =>
    ["download", "prepare"].includes(j.kind),
  );
  const latestSourceJob = sourceJobs.at(-1);
  const sourceActive = sourceJobs.some((j) =>
    ["queued", "running", "waiting_provider"].includes(j.state),
  );
  const canImport =
    !p.media &&
    !p.segments.length &&
    !connectionLost &&
    !sourceActive &&
    (p.stage === "upload" ||
      (latestSourceJob &&
        ["failed", "cancelled"].includes(latestSourceJob.state)));
  function nextStep() {
    return (
      <>
        {step === "corriger" && p.stage === "arabic" && (
          <section
            className="next-step"
            id="validation"
            data-position="bottom"
            tabIndex={-1}
            aria-label="Validation des sous-titres"
          >
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
                ? "Valider et relire la traduction"
                : "Valider et traduire"}
            </button>
          </section>
        )}
        {step === "traduire" && p.stage === "review" && (
          <section
            className="next-step"
            id="validation"
            data-position="bottom"
            tabIndex={-1}
            aria-label="Validation des sous-titres"
          >
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
              Valider et exporter
            </button>
          </section>
        )}
      </>
    );
  }
  return (
    <div className={showPlayer ? "editor has-media" : "editor"}>
      <button className="back" onClick={() => void action(back)}>
        ← Mes projets
      </button>
      <div className="page-title">
        <div>
          <p className="eyebrow">
            {step === currentStep(p)
              ? stageNames[p.stage]
              : step === "corriger"
                ? "Relire l’arabe"
                : step === "traduire"
                  ? "Relire la traduction"
                  : "Vidéo préparée"}
          </p>
          <textarea
            ref={titleField}
            rows={1}
            className="project-title"
            aria-label="Titre du projet"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              void saveTitle().catch((e) => setError(String(e)));
            }}
          />
          {p.url && /^https?:\/\//.test(p.url) && (
            <div className="source-link">
              <button
                className="copy-source"
                aria-label="Copier le lien YouTube"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(p.url!);
                    setCopyNotice("Lien copié");
                  } catch {
                    setCopyNotice(
                      "Copie indisponible. Vous pouvez sélectionner le lien pour le copier.",
                    );
                  }
                }}
              >
                {copyNotice === "Lien copié" ? (
                  <Check size={18} aria-hidden="true" />
                ) : (
                  <Copy size={18} aria-hidden="true" />
                )}
                <span>{p.url}</span>
              </button>
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Ouvrir la vidéo YouTube"
              >
                <ExternalLink size={18} aria-hidden="true" />
              </a>
              <small aria-live="polite">{copyNotice}</small>
            </div>
          )}
        </div>
        <small role="status">{d.status}</small>
      </div>
      <ol className="steps" aria-label="Étapes du projet">
        {steps.map((entry, i) => (
          <li className={step === entry.slug ? "current" : ""} key={entry.slug}>
            <button
              aria-label={`${i + 1}. ${entry.label}`}
              aria-current={step === entry.slug ? "step" : undefined}
              disabled={!canVisitStep(p, entry.slug) || busy || uploading}
              title={
                !canVisitStep(p, entry.slug)
                  ? "Terminez et validez l’étape précédente"
                  : undefined
              }
              onClick={() => {
                if (entry.slug !== step) void navigateStep(entry.slug);
              }}
            >
              <span aria-hidden="true">{i + 1}</span>
              {entry.label}
            </button>
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
      {connectionLost && (
        <p className="error" role="alert">
          Connexion interrompue : la progression affichée n’est plus à jour.
          Reconnexion automatique…
        </p>
      )}
      {jobs
        .filter(visibleJob)
        .filter((j) => !["succeeded", "cancelled"].includes(j.state))
        .map((j) => (
          <section className="job" key={j.id}>
            <h2>
              {{
                download: "Téléchargement vidéo",
                prepare: "Vérification de la vidéo",
                transcribe: "Transcription",
                cleanup: "Correction automatique de l’arabe",
                translate: "Traduction",
              }[j.kind] || "Création de la vidéo sous-titrée"}
            </h2>
            {j.message && <p>{j.message}</p>}
            {j.state === "waiting_provider" && (
              <p className="progress-note">
                Cette étape doit se terminer avant de continuer. La reprise est
                automatique : vous pouvez revenir plus tard.
              </p>
            )}
            {!connectionLost && <JobProgress job={j} />}
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
            {j.state === "waiting_provider" && (
              <button
                disabled={busy || uploading}
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
      {step === "preparer" && canImport && (
        <section className="panel">
          <h2>{uploading ? "Envoi de la vidéo…" : "Ajouter votre vidéo"}</h2>
          <p>
            {p.url
              ? "Après l’échec ou l’annulation du téléchargement, vous pouvez choisir une vidéo de votre appareil."
              : "Choisissez une vidéo depuis votre appareil."}
          </p>
          <label className="button">
            Importer la vidéo depuis mon appareil
            <input
              disabled={uploading || busy}
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
        .filter(visibleJob)
        .filter(
          (j) =>
            j.state === "cancelled" &&
            (!["download", "prepare"].includes(j.kind) ||
              (!p.media && j === latestSourceJob && !sourceActive)),
        )
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
      {validating && (
        <div className="validation-shortcut">
          <a
            href="#validation"
            onClick={(event) => {
              event.preventDefault();
              const target = document.getElementById("validation");
              target?.focus({ preventScroll: true });
              target?.scrollIntoView({ block: "end" });
            }}
          >
            Aller à la validation
          </a>
        </div>
      )}
      {step === "exporter" && p.stage === "ready" && (
        <section className="panel export-panel">
          <h2>Votre vidéo sous-titrée</h2>
          <p className="export-edit-help">
            Une correction ? Modifiez les textes ci-dessous, puis validez à
            nouveau pour créer une vidéo à jour.
          </p>
          <div className="row">
            <p className="export-language">Sous-titres français</p>
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
                  track: "fr",
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
      {showPlayer && (
        <section
          className={`player ${expanded ? "expanded" : ""}`}
          aria-label="Lecteur vidéo"
        >
          <div className="video-preview">
            <video
              playsInline
              preload="metadata"
              ref={media}
              src={`/api/projects/${p.id}/media`}
              onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                e.currentTarget.preservesPitch = true;
                e.currentTarget.playbackRate = playbackRate;
              }}
              onRateChange={(e) =>
                setPlaybackRate(e.currentTarget.playbackRate)
              }
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          </div>
          <div className="player-controls">
            <button onClick={() => seek(-5)} aria-label="Reculer de 5 secondes">
              <RotateCcw size={20} aria-hidden="true" />
              <span>5</span>
            </button>
            <button
              className="primary play-button"
              aria-label={playing ? "Pause" : "Lecture"}
              onClick={togglePlayback}
            >
              {playing ? (
                <Pause size={23} aria-hidden="true" />
              ) : (
                <Play size={23} aria-hidden="true" />
              )}
            </button>
            <button onClick={() => seek(5)} aria-label="Avancer de 5 secondes">
              <RotateCw size={20} aria-hidden="true" />
              <span>5</span>
            </button>
            <span className="playback-time">
              {time(current * 1000)} / {time(p.duration_ms)}
            </span>
          </div>
          <button
            className="expand-player"
            aria-label={expanded ? "Réduire la vidéo" : "Agrandir la vidéo"}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <Minimize2 size={20} aria-hidden="true" />
            ) : (
              <Maximize2 size={20} aria-hidden="true" />
            )}
          </button>
          <input
            aria-label="Position de lecture"
            type="range"
            min={0}
            max={p.duration_ms / 1000 || 1}
            step={0.1}
            value={current}
            onChange={(e) => {
              seekTo(Number(e.target.value));
            }}
          />
          <div className="playback-speed">
            <label htmlFor="playback-speed">Vitesse</label>
            <select
              id="playback-speed"
              value={playbackRate}
              onChange={(e) => changeSpeed(Number(e.target.value))}
              aria-describedby="speed-shortcuts"
              aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown"
            >
              {!playbackSpeeds.includes(playbackRate) && (
                <option value={playbackRate}>{speedLabel(playbackRate)}</option>
              )}
              {playbackSpeeds.map((rate) => (
                <option key={rate} value={rate}>
                  {speedLabel(rate)}
                  {rate === 1 ? " · normale" : ""}
                </option>
              ))}
            </select>
            <span id="speed-shortcuts" className="speed-shortcuts">
              Maj + ↑ accélérer · Maj + ↓ ralentir
            </span>
          </div>
        </section>
      )}
      {["transcribing", "cleaning"].includes(p.stage) && (
        <p className="notice" role="status">
          La transcription est en cours de préparation. Vous pourrez relire et
          modifier l’arabe une fois la correction automatique terminée.
        </p>
      )}
      {step === "traduire" && translationPending && (
        <p className="notice" role="status">
          La relecture sera disponible une fois la traduction terminée. Vous
          pouvez relire l’arabe à l’étape 2 ; l’export reste indisponible.
        </p>
      )}
      {step === "corriger" && translationPending && (
        <p className="notice" role="status">
          Arabe validé — lecture seule pendant la traduction. Retrouvez sa
          progression à l’étape 3.
        </p>
      )}
      {step === "preparer" && currentStep(p) !== "preparer" && (
        <section className="panel">
          <h2>Préparation terminée</h2>
          <p>La vidéo et la transcription corrigée sont disponibles.</p>
          <button onClick={() => void navigateStep("corriger")}>
            Relire l’arabe
          </button>
        </section>
      )}
      {showSegments && canVisitStep(p, "corriger") && p.segments.length > 0 && (
        <>
          <div className="editor-toolbar">
            {p.segments.length > 0 && (
              <button
                className="follow-toggle"
                aria-pressed={follow}
                onClick={() => setFollow((value) => !value)}
                title={
                  focused && follow
                    ? "Le défilement attend la fin de votre saisie"
                    : undefined
                }
              >
                Suivi {follow ? "activé" : "désactivé"}
              </button>
            )}
            <h2>
              {french
                ? "Relire arabe et français"
                : translationPending
                  ? "Arabe validé"
                  : "Correction arabe"}
            </h2>
          </div>
          <details className="translation-help">
            <summary>À propos de la traduction</summary>
            <p>
              La traduction reste modifiable. La vérification automatique des
              citations religieuses n’est pas activée ; vérifiez les références
              avant publication.
            </p>
          </details>
          {p.stage === "arabic" &&
            p.translation_source > 0 &&
            p.translation_source !== p.arabic_version && (
              <p className="notice">
                L’arabe a changé. La traduction précédente est conservée ; une
                nouvelle traduction remplacera les retouches françaises après
                votre confirmation.
              </p>
            )}
          <div className="segments">
            {p.segments.map((s) => (
              <article
                id={`segment-${s.id}`}
                key={s.id}
                className={`segment ${s.id === active ? "active" : ""}`}
              >
                <button
                  className="timestamp"
                  onClick={() => {
                    seekTo(s.start_ms / 1000);
                  }}
                >
                  {time(s.start_ms)} — {time(s.end_ms)}
                </button>
                <div className={french ? "fields bilingual" : "fields"}>
                  {translationPending ? (
                    <p className="readonly-arabic" lang="ar" dir="rtl">
                      {s.arabic}
                    </p>
                  ) : (
                    field(s, "arabic")
                  )}
                  {french && field(s, "french")}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {nextStep()}
      {step === "corriger" && canVisitStep(p, "traduire") && (
        <div className="next-step">
          <button disabled={busy} onClick={() => void navigateStep("traduire")}>
            {translationPending
              ? "Voir la progression de la traduction"
              : "Relire la traduction"}
          </button>
        </div>
      )}
      {step === "traduire" && p.stage === "ready" && (
        <div className="next-step">
          <button disabled={busy} onClick={() => void navigateStep("exporter")}>
            Revenir à l’export
          </button>
        </div>
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
    </div>
  );
}
