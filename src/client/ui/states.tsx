import { useEffect, useRef, type ReactNode } from "react";
import { btn, card, cn, meta } from "./primitives";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-muted", className)} aria-hidden="true" />;
}

export function SkeletonCard() {
  return (
    <div className={card}>
      <Skeleton className="mb-3 h-4 w-1/3" />
      <Skeleton className="mb-2 h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export function LoadingScreen({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3 text-muted" role="status">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
      <span className={meta}>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn(card, "flex flex-col items-center gap-2 py-10 text-center")}>
      <p className="font-medium text-text">{title}</p>
      {description && <p className={meta}>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className={cn(card, "flex flex-col items-center gap-3 border-danger/30 py-10 text-center")}>
      <p className="font-medium text-danger">{title}</p>
      {description && <p className={meta}>{description}</p>}
      {onRetry && (
        <button className={btn("default")} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Banner({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "danger" | "warning" | "success";
  children: ReactNode;
}) {
  const toneClass = {
    neutral: "border-border bg-surface-muted text-text",
    danger: "border-danger/30 bg-danger-muted text-danger",
    warning: "border-warning/30 bg-warning-muted text-warning",
    success: "border-success/30 bg-success-muted text-success",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm", toneClass)}>
      {children}
    </div>
  );
}

/**
 * Minimal accessible modal dialog: focus-trapped-enough for our needs (moves
 * focus in on open, restores it on close, closes on Escape and backdrop
 * click), labelled by `title`.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className={cn(card, "w-full max-w-sm")}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="mb-1 text-base font-semibold text-text">
          {title}
        </h2>
        {description && <p className={cn(meta, "mb-4")}>{description}</p>}
        <div className="flex justify-end gap-2">
          <button className={btn("default")} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            ref={ref}
            className={btn(danger ? "danger" : "primary")}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
