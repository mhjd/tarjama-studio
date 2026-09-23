import type { Job } from "./api";

export function JobProgress({ job }: { job: Job }) {
  const total =
    job.kind === "download"
      ? 6
      : job.kind === "prepare" || job.kind.startsWith("export_")
        ? 3
        : 0;
  const active = job.state === "running";
  const waiting = job.state === "waiting_provider";
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
      {!["failed", "waiting_provider"].includes(job.state) && (
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
