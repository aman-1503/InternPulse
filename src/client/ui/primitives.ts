/**
 * Small shared Tailwind class fragments so screens compose consistently
 * without repeating the same utility strings everywhere. Deliberately not a
 * component library — just named constants/functions for the handful of
 * patterns (card, meta text, buttons, badges) used across every screen.
 */
export const card = "rounded-xl border border-border bg-surface p-4 shadow-sm";
export const cardTight = "rounded-xl border border-border bg-surface p-3 shadow-sm";
export const meta = "text-sm text-muted";
export const sectionTitle = "text-sm font-semibold text-text";
export const list = "space-y-2";
export const stack = "flex flex-col gap-2";
export const row = "flex flex-wrap items-center gap-2";
export const input =
  "w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text placeholder:text-muted focus-visible:border-accent";
export const textarea = input + " resize-y";
export const select = input;

export const button = {
  base: "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  default: "border border-border bg-surface text-text hover:bg-surface-muted",
  primary: "bg-accent text-white hover:opacity-90",
  danger: "border border-danger/30 bg-danger-muted text-danger hover:bg-danger/10",
  ghost: "text-muted hover:bg-surface-muted hover:text-text",
  link: "text-accent underline-offset-2 hover:underline",
};

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
};
