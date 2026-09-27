import type { Job } from "./api";

// Text retries deliberately have no public error message until recovery ends.
// Provider outages/quota waits carry a message and remain explicitly actionable.
export function isAutomaticTextRecovery(job: Job) {
  return (
    (job.kind === "cleanup" || job.kind === "translate") &&
    job.state === "waiting_provider" &&
    job.message === ""
  );
}

export function JobProgress({ job }: { job: Job }) {
  const total =
    job.kind === "download" || job.kind === "restore_download"
      ? 6
      : job.kind === "prepare" ||
          job.kind === "restore_prepare" ||
          job.kind.startsWith("export_")
        ? 3
        : 0;
  const recovering = isAutomaticTextRecovery(job);
  const active = job.state === "running" || recovering;
  const waiting = job.state === "waiting_provider" && !recovering;
  const progress = Math.max(0, Math.min(100, job.progress));
  const completed = total ? Math.round((progress * total) / 100) : 0;
  return (
    <div className="job-progress" role="status" aria-live="polite">
      <p className="job-activity">
        {active && <span className="activity-spinner" aria-hidden="true" />}
        {waiting
          ? "En attente — reprise automatique"
          : job.state === "failed"
            ? "Intervention nécessaire"
            : active
              ? "Traitement en cours…"
              : "En file d’attente…"}
      </p>
      {job.state !== "failed" && !waiting && (
        <>
          {total ? (
            <>
              <progress
                value={completed}
                max={total}
                aria-label="Étapes de préparation terminées"
              />
              <small>
                {completed} sur {total} étapes terminées
              </small>
              <p className="progress-note">
                Chaque étape peut prendre un temps différent. Vous pouvez
                quitter cette page et revenir : le traitement continue.
              </p>
            </>
          ) : (
            <>
              <progress
                value={progress}
                max={100}
                aria-label="Morceaux terminés"
              />
              <small>{progress}% des morceaux terminés</small>
            </>
          )}
        </>
      )}
    </div>
  );
}
