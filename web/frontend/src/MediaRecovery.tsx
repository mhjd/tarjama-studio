import { useEffect, useRef, useState, type Ref } from "react";
import type { Job } from "./api";

const downloadSteps = [
  "Téléchargement de la vidéo",
  "Téléchargement de l’audio",
  "Assemblage vidéo et audio",
  "Vérification de la vidéo",
  "Préparation pour la lecture",
  "Vérification du résultat",
];
const prepareSteps = downloadSteps.slice(3);

export function MediaRecovery({
  job,
  uploaded,
  busy,
  uploading,
  disconnected,
  sticky,
  panelRef,
  recover,
  retry,
  cancel,
  upload,
}: {
  job?: Job;
  uploaded: boolean;
  busy: boolean;
  uploading: boolean;
  disconnected: boolean;
  sticky: boolean;
  panelRef: Ref<HTMLElement>;
  recover: () => void;
  retry: () => void;
  cancel: () => void;
  upload: (file: File) => void;
}) {
  const [details, setDetails] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const state = job?.state;
  const waiting = state === "waiting_provider";
  const active = ["queued", "running", "waiting_provider"].includes(
    state || "",
  );
  const running = state === "running";
  const stopped = state === "failed" || state === "cancelled";
  const finished = state === "succeeded";
  useEffect(() => {
    if (details && uploaded && !active)
      fileInput.current?.focus({ preventScroll: true });
  }, [details, uploaded, active]);
  const exporting = job?.kind.startsWith("export_");
  const steps = exporting ? [] : uploaded ? prepareSteps : downloadSteps;
  // This is a count of durable completed stages, not a download percentage.
  const completed = Math.min(
    steps.length,
    Math.max(0, Math.round(((job?.progress || 0) * steps.length) / 100)),
  );
  const phase =
    completed === steps.length ? "Finalisation de la vidéo" : steps[completed];
  const next = new Date(
    (job?.next_attempt_at || "")
      .replace(" ", "T")
      .replace(/([+-]\d{2})$/, "$1:00"),
  );
  const retryTime =
    Number.isFinite(next.getTime()) && next.getTime() > Date.now()
      ? `Nouvelle tentative automatique prévue à ${next.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`
      : "Nouvelle tentative automatique dès que le service sera disponible.";
  const title = disconnected
    ? "Connexion interrompue"
    : uploading
      ? "Envoi de votre vidéo…"
      : waiting
        ? "En attente du service vidéo"
        : state === "queued"
          ? "Récupération en file d’attente"
          : running
            ? `${exporting ? "Récupération avant export" : phase}…`
            : finished
              ? "Vidéo récupérée — actualisation du lecteur…"
              : state === "failed"
                ? "La récupération n’a pas abouti"
                : state === "cancelled"
                  ? "Récupération annulée"
                  : "Vidéo expirée";

  return (
    <section
      ref={panelRef}
      className={`${sticky ? "player" : "panel"} media-recovery`}
      aria-label="Lecteur indisponible"
      aria-busy={!disconnected && (running || uploading)}
    >
      <div className="recovery-summary" role="status" aria-live="polite">
        <strong>
          {!disconnected && (running || uploading) && (
            <span className="activity-spinner" aria-hidden="true" />
          )}
          {title}
        </strong>
        <p>
          {disconnected
            ? "État non actualisé. Reconnexion automatique…"
            : uploading
              ? "Gardez cette page ouverte jusqu’à la fin de l’envoi."
              : waiting
                ? retryTime
                : running && steps.length
                  ? `Étape ${Math.min(completed + 1, steps.length)} sur ${steps.length} · Vous pouvez continuer à relire vos textes.`
                  : active
                    ? "Votre demande est conservée. Vous pouvez continuer à relire vos textes."
                    : "Vos sous-titres sont conservés."}
        </p>
      </div>
      <div className="recovery-actions">
        {disconnected ? null : active ? (
          <button disabled={busy || uploading} onClick={cancel}>
            Annuler la récupération
          </button>
        ) : stopped ? (
          <button disabled={busy || uploading} onClick={retry}>
            Reprendre la récupération
          </button>
        ) : (
          !finished && (
            <button
              disabled={busy || uploading}
              onClick={() => (uploaded ? setDetails(!details) : recover())}
            >
              {uploaded ? "Réimporter la vidéo" : "Récupérer la vidéo"}
            </button>
          )
        )}
      </div>
      <details
        className="recovery-details"
        open={details}
        onToggle={(e) => setDetails(e.currentTarget.open)}
      >
        <summary>
          {active || stopped
            ? "Voir la progression"
            : "À propos de la récupération"}
        </summary>
        <div className="recovery-detail-body">
          {job && steps.length > 0 && (
            <>
              <ol aria-label="Étapes de récupération">
                {steps.map((label, index) => (
                  <li
                    key={label}
                    aria-current={
                      !disconnected && running && index === completed
                        ? "step"
                        : undefined
                    }
                  >
                    <span aria-hidden="true">
                      {index < completed ? "✓" : index + 1}
                    </span>
                    {label}
                    <small>
                      {index < completed
                        ? "Terminée"
                        : !disconnected && running && index === completed
                          ? "En cours"
                          : "En attente"}
                    </small>
                  </li>
                ))}
              </ol>
              <p>
                La progression indique les étapes terminées. Le pourcentage
                exact du téléchargement n’est pas disponible.
              </p>
            </>
          )}
          {waiting && (
            <p>
              Le service vidéo ne peut pas poursuivre pour le moment. Il n’est
              pas nécessaire d’annuler ni de relancer : votre demande sera
              reprise automatiquement.
            </p>
          )}
          <p>
            {uploaded
              ? "La vidéo importée a été supprimée après une semaine. Réimportez la même vidéo originale pour retrouver la lecture ou créer un export."
              : "La vidéo a été supprimée après une semaine. Elle sera récupérée automatiquement pour un export vidéo, ou à votre demande pour la lecture."}{" "}
            Les textes et les fichiers SRT restent disponibles.
          </p>
          {uploaded && !active && !finished && (
            <label>
              Réimporter la vidéo originale
              <input
                ref={fileInput}
                type="file"
                accept="video/*"
                disabled={busy || uploading || disconnected}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload(file);
                }}
              />
            </label>
          )}
        </div>
      </details>
    </section>
  );
}
