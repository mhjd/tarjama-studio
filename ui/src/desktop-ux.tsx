import React, { useEffect, useRef, useState } from "react";
import { Copy, RotateCcw, Square, X } from "lucide-react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type AccessibleModalProps = {
  children: React.ReactNode;
  labelledBy: string;
  onClose: () => void;
  closeOnBackdrop?: boolean;
  closeDisabled?: boolean;
  closeKeys?: string[];
  className?: string;
};

export function AccessibleModal({
  children,
  labelledBy,
  onClose,
  closeOnBackdrop = true,
  closeDisabled = false,
  closeKeys = ["Escape"],
  className = "",
}: AccessibleModalProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const preferred = dialog?.querySelector<HTMLElement>("[data-autofocus]");
    const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (preferred ?? first ?? dialog)?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!closeDisabled && closeKeys.some((key) => event.key.toLocaleLowerCase() === key.toLocaleLowerCase())) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!closeDisabled && closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </section>
    </div>
  );
}

export function ModalCloseButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button className="icon-button" disabled={disabled} onClick={onClick} title="Fermer - Échap" aria-label="Fermer">
      <X size={18} />
    </button>
  );
}

type ErrorNoticeProps = {
  details: string;
  onRetry?: () => void;
  onOptions?: () => void;
  onChooseAnother?: () => void;
};

export function ErrorNotice({ details, onRetry, onOptions, onChooseAnother }: ErrorNoticeProps) {
  const firstLine = details.split(/\r?\n/, 1)[0] || "Une erreur est survenue";
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  async function copyDetails() {
    try {
      await writeClipboardText(details);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }
  return (
    <section className="error-notice" role="alert">
      <strong>{firstLine}</strong>
      {details !== firstLine && <details><summary>Détails techniques</summary><pre>{details}</pre></details>}
      <div className="error-actions">
        <button onClick={() => void copyDetails()}>
          <Copy size={15} />
          <span>{copyState === "copied" ? "Détails copiés" : copyState === "error" ? "Copie impossible" : "Copier les détails"}</span>
        </button>
        {onRetry && <button onClick={onRetry}><RotateCcw size={15} /><span>Réessayer</span></button>}
        {onOptions && <button onClick={onOptions}><span>Ouvrir les options</span></button>}
        {onChooseAnother && <button onClick={onChooseAnother}><span>Choisir un autre fichier</span></button>}
      </div>
    </section>
  );
}

type OperationProgressProps = {
  message: string;
  percent?: number;
  detail?: string;
  elapsed: string;
  onCancel: () => void;
  cancelling?: boolean;
};

export function OperationProgress({
  message,
  percent,
  detail,
  elapsed,
  onCancel,
  cancelling = false,
}: OperationProgressProps) {
  return (
    <div className="download-progress operation-progress" role="status" aria-live="polite">
      <div>
        <span>{message}</span>
        {percent !== undefined && <strong>{percent.toFixed(1)}%</strong>}
      </div>
      <progress value={percent ?? undefined} max="100" />
      <div className="operation-progress-footer">
        <small>{[detail, `Écoulé ${elapsed}`].filter(Boolean).join(" · ")}</small>
        <button className="icon-button stop-operation" onClick={onCancel} disabled={cancelling} title="Arrêter l’opération" aria-label="Arrêter l’opération">
          <Square size={14} fill="currentColor" />
        </button>
      </div>
    </div>
  );
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export async function writeClipboardText(text: string): Promise<void> {
  if (window.tarjamaDesktop) {
    await window.tarjamaDesktop.copyText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}
