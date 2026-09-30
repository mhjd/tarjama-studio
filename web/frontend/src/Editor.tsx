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
  ArrowUpToLine,
  ArrowDownToLine,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  request,
  upload,
  downloadSubtitles,
  stageNames,
  time,
  type Project,
  type Segment,
  type Job,
  type Field,
} from "./api";
import { Drafts } from "./drafts";
import { SubtitleInput } from "./SubtitleInput";
import { MediaRecovery } from "./MediaRecovery";
import { JobProgress, isAutomaticTextRecovery } from "./JobProgress";
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
    [optionsOpen, setOptionsOpen] = useState(false),
    [pageDestination, setPageDestination] = useState<"top" | "bottom" | null>(
      null,
    ),
    [follow, setFollow] = useState(true),
    [focused, setFocused] = useState(false),
    [expanded, setExpanded] = useState(false),
    [quality, setQuality] = useState("low"),
    [title, setTitle] = useState(p.title),
    [replace, setReplace] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false),
    [copyNotice, setCopyNotice] = useState("");
  const titleField = useRef<HTMLTextAreaElement>(null);
  const player = useRef<HTMLElement>(null);
  const optionsPanel = useRef<HTMLDivElement>(null);
  const optionsToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!optionsOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !optionsPanel.current?.contains(event.target) &&
        !optionsToggle.current?.contains(event.target)
      )
        setOptionsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOptionsOpen(false);
        optionsToggle.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [optionsOpen]);
  const pageJump = useRef(false);
  useEffect(() => {
    const element = player.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        "--player-height",
        `${element.getBoundingClientRect().height}px`,
      ),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--player-height");
    };
  }, [p.media, p.media_expired, p.stage, step]);
  useEffect(() => {
    const element = player.current;
    const viewport = window.visualViewport;
    if (!element || !viewport) return;
    const mobile = window.matchMedia("(max-width: 640px)");
    let frame = 0;
    let inset = 0;
    const align = () => {
      frame = 0;
      let next = 0;
      if (mobile.matches && Math.abs(viewport.scale - 1) < 0.01) {
        // Mobile browser chrome can shrink the visible area independently of
        // the fixed-position viewport. Measure the actual box: some engines
        // already compensate, so subtracting viewport heights would lift twice.
        const bottom = element.getBoundingClientRect().bottom + inset;
        const gap = parseFloat(getComputedStyle(element).bottom) - inset;
        next = Math.max(
          0,
          Math.ceil(bottom + gap - viewport.offsetTop - viewport.height),
        );
      }
      inset = next;
      element.style.setProperty("--player-bottom-inset", `${inset}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(align);
    };
    align();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      element.style.removeProperty("--player-bottom-inset");
    };
  }, [p.media, p.media_expired, p.stage, step]);
  useLayoutEffect(() => {
    if (pageDestination === null) return;
    // Scroll after React closes Options, without leaving focus in a hidden
    // panel. Clamp the destination rather than requesting an overscroll.
    window.scrollTo({
      top:
        pageDestination === "top"
          ? 0
          : Math.max(
              0,
              document.documentElement.scrollHeight - window.innerHeight,
            ),
      behavior: "instant",
    });
    setPageDestination(null);
  }, [pageDestination]);
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
    const before = d.project;
    const x = await request<{ project: Project; jobs: Job[] }>(
      `/api/projects/${p.id}`,
    );
    if (!mounted.current) return;
    setConnectionLost(false);
    // A save/action or another poll may have completed while this read was in flight.
    // Never replace its acknowledgement with an older snapshot.
    if (d.project !== before) return;
    setJobs(x.jobs);
    if (!d.dirty) d.adopt(x.project);
    else if (x.project.generation === d.project.generation) {
      // Media can finish restoring while a subtitle draft is still being typed.
      // Refresh only availability, preserving text, versions and pending edits.
      d.adopt({
        ...d.project,
        media: x.project.media,
        media_expired: x.project.media_expired,
        media_expires_at: x.project.media_expires_at,
        media_uploaded: x.project.media_uploaded,
      });
    }
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
  function downloadVideo(job: Job) {
    // action() has flushed edits. Never download a stale render after that save.
    if (
      job.source_version !== d.project.version ||
      job.generation !== d.project.generation ||
      d.project.stage !== "ready"
    )
      throw new Error(
        "Les textes ont changé. Validez-les à nouveau pour créer une vidéo à jour.",
      );
    // Native download keeps large videos out of JavaScript memory and preserves
    // the project filename supplied by Content-Disposition.
    const link = document.createElement("a");
    link.href = `/api/projects/${p.id}/exports/${job.id}`;
    link.download = "";
    document.body.append(link);
    link.click();
    link.remove();
  }
  async function sendFile(file: File, restore = false) {
    if (file.size > 1024 * 1024 * 1024) {
      setError("La vidéo dépasse 1 Go.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      if (restore) await flush();
      d.adopt(await upload(p.id, file, restore));
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
      !pageJump.current &&
      !focused &&
      active &&
      (current > 0 || seekVersion > 0 || playing)
    )
      document
        .getElementById(`segment-${active}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, follow, focused, seekVersion, playing]);
  function seekTo(seconds: number) {
    pageJump.current = false;
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
  function scrollPage(end: "top" | "bottom") {
    // An explicit page jump pauses playback so follow cannot immediately undo it.
    // Keep the user's follow preference for the next playback/seek.
    pageJump.current = true;
    media.current?.pause();
    setPlaying(false);
    if (optionsToggle.current?.getClientRects().length)
      optionsToggle.current.focus({ preventScroll: true });
    setOptionsOpen(false);
    setPageDestination(end);
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
    step === "corriger" || (step === "traduire" && !translationPending);
  const showPlayer =
    Boolean(p.media) &&
    step !== "exporter" &&
    !(step === "traduire" && translationPending);
  const showMissingPlayer =
    !p.media && p.media_expired && showSegments && canVisitStep(p, "corriger");
  const validating =
    (step === "corriger" && p.stage === "arabic") ||
    (step === "traduire" && p.stage === "review");
  const selectedExport = [...jobs]
    .reverse()
    .find(
      (job) =>
        job.kind === `export_fr_${quality}` &&
        job.source_version === p.version &&
        job.generation === p.generation,
    );
  const exportActive =
    selectedExport &&
    ["queued", "running", "waiting_provider"].includes(selectedExport.state);
  const exportReady = selectedExport?.state === "succeeded";
  const activeRecovery = jobs.find(
    (j) =>
      j.generation === p.generation &&
      j.kind.startsWith("restore_") &&
      ["queued", "running", "waiting_provider"].includes(j.state),
  );
  const recoveryJob =
    activeRecovery ??
    jobs
      .filter(
        (j) =>
          j.generation === p.generation &&
          !["succeeded", "expired"].includes(j.state) &&
          (j.kind.startsWith("restore_") ||
            (j.kind.startsWith("export_") && j.source_version === p.version)),
      )
      .at(-1);
  function subtitleDownloads() {
    return (
      <div className="subtitle-download-actions">
        <button
          disabled={busy || uploading}
          onClick={() => void action(() => downloadSubtitles(d.project, "ar"))}
        >
          Télécharger l’arabe · SRT
        </button>
        {p.translation_source > 0 && (
          <button
            className="primary"
            disabled={busy || uploading}
            onClick={() =>
              void action(() => downloadSubtitles(d.project, "fr"))
            }
          >
            Télécharger le français · SRT
          </button>
        )}
      </div>
    );
  }
  function restorePlayback() {
    return action(async () => {
      d.adopt(
        await request<Project>(`/api/projects/${p.id}/media/restore`, "POST"),
      );
    });
  }
  function visibleJob(job: Job) {
    if (job.kind.startsWith("restore_")) return false;
    if (p.media_expired && !p.media && job === recoveryJob) return false;
    if (job.kind === "translate")
      return step === "traduire" && translationPending;
    if (job.kind.startsWith("export_"))
      return (
        step === "exporter" &&
        job.source_version === p.version &&
        job.generation === p.generation
      );
    return step === "preparer" && currentStep(p) === "preparer";
  }
  function field(s: Segment, f: Field) {
    const key = `${s.id}:${f}`;
    return (
      <label key={key} className={f}>
        <span>{f === "arabic" ? "Arabe" : "Français"}</span>
        <SubtitleInput
          aria-label={`${f === "arabic" ? "Arabe" : "Français"} ${s.id}`}
          lang={f === "arabic" ? "ar" : "fr"}
          dir={f === "arabic" ? "rtl" : "ltr"}
          rows={3}
          inputRef={(el) => {
            if (el) fields.current.set(key, el);
            else fields.current.delete(key);
          }}
          value={d.value(s, f)}
          disabled={!editable || busy || uploading}
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
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  d.adopt(
                    await request<Project>(
                      `/api/projects/${p.id}/advance`,
                      "POST",
                      {
                        version: d.project.version,
                        stage: "arabic",
                        replace_translation: false,
                      },
                    ),
                  );
                })
              }
            >
              {p.translation_source > 0
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
    <div
      className={
        showPlayer || showMissingPlayer ? "editor has-media" : "editor"
      }
    >
      <button className="back" onClick={() => void action(back)}>
        ← Mes projets
      </button>
      {p.archived && (
        <section className="notice" aria-label="Projet archivé">
          <p>
            Ce projet est archivé. Sa vidéo et ses sous-titres sont conservés.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                d.adopt(
                  await request<Project>(
                    `/api/projects/${p.id}/archive`,
                    "PATCH",
                    { archived: false },
                  ),
                );
              })
            }
          >
            Restaurer
          </button>
        </section>
      )}
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
        .filter((j) => !["succeeded", "cancelled", "expired"].includes(j.state))
        .map((j) => (
          <section className="job" key={j.id}>
            <h2>
              {{
                download: "Téléchargement vidéo",
                restore_download: "Récupération de la vidéo",
                restore_prepare: "Vérification de la vidéo réimportée",
                prepare: "Vérification de la vidéo",
                transcribe: "Transcription",
                cleanup: "Correction automatique de l’arabe",
                translate: "Traduction",
              }[j.kind] || "Création de la vidéo sous-titrée"}
            </h2>
            {j.message && <p>{j.message}</p>}
            {j.state === "waiting_provider" && !isAutomaticTextRecovery(j) && (
              <p className="progress-note">
                Cette étape doit se terminer avant de continuer. La reprise est
                automatique : vous pouvez revenir plus tard.
              </p>
            )}
            {!connectionLost && <JobProgress job={j} />}
            {j.state === "failed" ||
            (j.state === "waiting_provider" && !isAutomaticTextRecovery(j)) ? (
              <button
                disabled={
                  busy ||
                  uploading ||
                  Boolean(activeRecovery && j.kind.startsWith("export_"))
                }
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
          <p>
            Attention : la vidéo sera supprimée des serveurs après une semaine.
            Après cela, vous devrez la réimporter pour effectuer un export
            vidéo. Vos textes corrigés restent conservés.
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
      {translationPending && p.translation_source > 0 && (
        <section className="panel">
          <p>
            Votre traduction précédente reste conservée pendant cette nouvelle
            traduction.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                d.adopt(
                  await request<Project>(
                    `/api/projects/${p.id}/advance`,
                    "POST",
                    { version: d.project.version, stage: "keep_translation" },
                  ),
                );
              })
            }
          >
            Arrêter et conserver la traduction précédente
          </button>
        </section>
      )}
      {step === "exporter" && p.stage === "ready" && (
        <>
          <div className="export-review-link">
            <button
              disabled={busy || uploading}
              onClick={() => void navigateStep("traduire")}
            >
              Modifier la traduction
            </button>
          </div>
          <div className="export-options">
            <section
              className="panel export-panel"
              aria-labelledby="video-export-title"
            >
              <h2 id="video-export-title">Votre vidéo sous-titrée</h2>
              <p>
                Créez une vidéo avec les sous-titres français intégrés à
                l’image.
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
                Les vidéos exportées sont conservées 24 heures. Les sous-titres
                restent disponibles sans limite de durée.
              </p>
              <p>
                Low produit un fichier plus léger. La taille finale dépend de la
                durée.
              </p>
              {activeRecovery && !exportReady && (
                <p role="status">
                  {exportActive
                    ? "La création attend la fin de la récupération de la vidéo."
                    : "Attendez la fin de la récupération de la vidéo avant de lancer sa création. Les sous-titres SRT restent disponibles."}
                </p>
              )}
              {exportReady && selectedExport ? (
                <a
                  className="button primary export-download"
                  href={`/api/projects/${p.id}/exports/${selectedExport.id}`}
                  download
                  aria-disabled={busy || uploading || undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    void action(async () => downloadVideo(selectedExport));
                  }}
                >
                  Télécharger la vidéo
                </a>
              ) : (
                <button
                  className="primary"
                  disabled={
                    busy ||
                    uploading ||
                    Boolean(exportActive) ||
                    Boolean(activeRecovery) ||
                    (!p.media && (!p.url || p.media_uploaded))
                  }
                  onClick={() =>
                    void action(async () => {
                      if (
                        selectedExport?.source_version === d.project.version &&
                        ["cancelled", "failed"].includes(selectedExport.state)
                      ) {
                        await request(
                          `/api/projects/${p.id}/jobs/${selectedExport.id}/retry`,
                          "POST",
                        );
                        return;
                      }
                      await request(`/api/projects/${p.id}/exports`, "POST", {
                        version: d.project.version,
                        track: "fr",
                        quality,
                      });
                    })
                  }
                >
                  {busy
                    ? "Envoi de la demande…"
                    : activeRecovery
                      ? "En attente de la vidéo"
                      : exportActive
                        ? "Création en cours…"
                        : selectedExport?.state === "cancelled"
                          ? "Reprendre la création"
                          : selectedExport?.state === "failed"
                            ? "Réessayer la création"
                            : "Créer la vidéo"}
                </button>
              )}
            </section>
            <section
              className="panel subtitle-export-panel"
              aria-labelledby="subtitle-export-title"
            >
              <h2 id="subtitle-export-title">Exporter les sous-titres</h2>
              <p>
                Format SRT, compatible avec les logiciels de montage et les
                lecteurs vidéo. Les sous-titres trop courts sont regroupés comme
                dans la vidéo, sans le style de Tarjama. Vos segments de
                relecture restent inchangés.
              </p>
              {subtitleDownloads()}
              <p className="subtitle-export-note">
                Disponibles immédiatement, même si la vidéo a expiré ou est en
                cours de récupération.
              </p>
            </section>
          </div>
        </>
      )}
      {p.media_expired && !p.media && (
        <MediaRecovery
          job={recoveryJob}
          uploaded={!p.url || Boolean(p.media_uploaded)}
          busy={busy}
          uploading={uploading}
          disconnected={connectionLost}
          sticky={Boolean(showMissingPlayer)}
          panelRef={player}
          recover={() => void restorePlayback()}
          retry={() =>
            recoveryJob &&
            void action(async () => {
              await request(
                `/api/projects/${p.id}/jobs/${recoveryJob.id}/retry`,
                "POST",
              );
            })
          }
          cancel={() =>
            recoveryJob &&
            void action(async () => {
              await request(
                `/api/projects/${p.id}/jobs/${recoveryJob.id}/cancel`,
                "POST",
              );
            })
          }
          upload={(file) => void sendFile(file, true)}
        />
      )}
      {showPlayer && (
        <section
          ref={player}
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
              onPlay={() => {
                pageJump.current = false;
                setPlaying(true);
              }}
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
          <div className="player-timeline">
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
            <button
              ref={optionsToggle}
              className="player-options-toggle"
              aria-expanded={optionsOpen}
              aria-controls="player-options"
              onClick={() => setOptionsOpen(!optionsOpen)}
            >
              Options · {speedLabel(playbackRate)}
            </button>
          </div>
          <div
            id="player-options"
            ref={optionsPanel}
            className="player-secondary"
            data-open={optionsOpen}
          >
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
                  <option value={playbackRate}>
                    {speedLabel(playbackRate)}
                  </option>
                )}
                {playbackSpeeds.map((rate) => (
                  <option key={rate} value={rate}>
                    {speedLabel(rate)}
                  </option>
                ))}
              </select>
              <span id="speed-shortcuts" className="speed-shortcuts">
                Maj + ↑ accélérer · Maj + ↓ ralentir
              </span>
            </div>
            <nav
              className="player-page-nav"
              aria-label="Navigation dans la page"
            >
              <button
                onClick={() => scrollPage("top")}
                title="Aller en haut de la page"
                aria-label="Aller en haut de la page"
              >
                <ArrowUpToLine size={19} aria-hidden="true" />
                <span>Haut</span>
              </button>
              <button
                onClick={() => scrollPage("bottom")}
                title="Aller en bas de la page"
                aria-label="Aller en bas de la page"
              >
                <ArrowDownToLine size={19} aria-hidden="true" />
                <span>Bas</span>
              </button>
            </nav>
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
          {p.translation_source > 0 &&
            p.translation_source !== p.arabic_version && (
              <p className="notice">
                L’arabe a été modifié. Votre traduction française est conservée
                et reste modifiable ; aucune retraduction automatique n’est
                lancée.
              </p>
            )}
          {editable && (
            <details className="translation-help">
              <summary>Exporter les sous-titres seuls (SRT)</summary>
              <p>
                Fichiers SRT avec les sous-titres trop courts regroupés comme
                dans la vidéo, pour votre logiciel de montage. Vos segments de
                relecture restent inchangés.
              </p>
              {subtitleDownloads()}
            </details>
          )}
          {p.translation_source > 0 &&
            (p.stage === "review" || p.stage === "ready") && (
              <details className="translation-help">
                <summary>Retraduire avec l’IA</summary>
                <p>
                  Cette action remplacera toute la traduction française, y
                  compris vos corrections. Vous pouvez aussi la modifier
                  vous-même.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={replace}
                    onChange={(e) => setReplace(e.target.checked)}
                  />{" "}
                  Je confirme le remplacement de la traduction française.
                </label>
                <button
                  disabled={busy || !replace}
                  onClick={() =>
                    void action(async () => {
                      d.adopt(
                        await request<Project>(
                          `/api/projects/${p.id}/advance`,
                          "POST",
                          {
                            version: d.project.version,
                            stage: "retranslate",
                            replace_translation: true,
                          },
                        ),
                      );
                      setReplace(false);
                    })
                  }
                >
                  Relancer la traduction
                </button>
              </details>
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
        <h2>{p.archived ? "Projet archivé" : "Ranger ce projet"}</h2>
        <p>
          L’archivage conserve les textes. Les vidéos restent soumises à leur
          délai de conservation ; les traitements en cours continuent.
        </p>
        <button
          disabled={busy || uploading}
          onClick={() =>
            void action(async () => {
              d.adopt(
                await request<Project>(
                  `/api/projects/${p.id}/archive`,
                  "PATCH",
                  { archived: !p.archived },
                ),
              );
              await back();
            })
          }
        >
          {p.archived ? "Restaurer le projet" : "Archiver le projet"}
        </button>
        <details className="delete-project">
          <summary>Suppression définitive</summary>
          {deleteOpen ? (
            <>
              <p>
                Supprimer ce projet, sa vidéo et ses traitements de votre espace
                ?
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
        </details>
      </section>
    </div>
  );
}
