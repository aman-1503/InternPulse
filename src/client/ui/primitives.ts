/**
 * Small shared Tailwind class fragments so screens compose consistently
 * without repeating the same utility strings everywhere. Deliberately not a
 * component library — just named constants/functions for the handful of
 * patterns (card, meta text, buttons, badges) used across every screen.
 */
export const card = "rounded-xl border border-border bg-surface p-4 shadow-sm transition-shadow";
export const cardTight = "rounded-xl border border-border bg-surface p-3 shadow-sm transition-shadow";
export const cardInteractive = card + " hover:border-accent/50 hover:shadow-md";
/** Card with a colored left accent bar — for items that need to read as urgent/critical at a glance. */
export function cardAccent(tone: "danger" | "warning" | "accent" = "danger"): string {
  const border = { danger: "border-l-danger", warning: "border-l-warning", accent: "border-l-accent" }[tone];
  return cn(card, "border-l-4", border);
}
export const meta = "text-sm text-muted";
export const metaXs = "text-xs text-muted";
export const sectionTitle = "text-sm font-semibold tracking-tight text-text";
export const pageTitle = "text-xl font-semibold tracking-tight text-text md:text-2xl";
export const list = "space-y-2";
export const stack = "flex flex-col gap-2";
export const row = "flex flex-wrap items-center gap-2";
export const divider = "border-t border-border";
export const input =
  "w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text shadow-sm placeholder:text-muted transition-colors focus-visible:border-accent";
export const textarea = input + " resize-y";
export const select = input;

export const button = {
  base: "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  default: "border border-border bg-surface text-text shadow-sm hover:bg-surface-muted hover:border-border",
  primary: "bg-accent text-white shadow-sm hover:opacity-90",
  danger: "border border-danger/30 bg-danger-muted text-danger hover:bg-danger/10",
  ghost: "text-muted hover:bg-surface-muted hover:text-text",
  link: "text-accent underline-offset-2 hover:underline",
};

/** Compact variant of any button style, for dense rows (table actions, card footers). */
export const buttonSm = "px-2 py-1 text-xs";

export function btn(variant: keyof typeof button = "default"): string {
  return `${button.base} ${button[variant]}`;
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Generic pill badge; pass explicit bg/text classes for semantic color. */
export function badge(className: string): string {
  return cn(
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
    className,
  );
}

export const badgeTones = {
  neutral: "bg-surface-muted text-muted",
  accent: "bg-accent-muted text-accent",
  success: "bg-success-muted text-success",
  warning: "bg-warning-muted text-warning",
  danger: "bg-danger-muted text-danger",
  critical: "bg-danger text-white",
};
