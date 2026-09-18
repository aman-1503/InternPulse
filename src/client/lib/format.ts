export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 90) return "a minute ago";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function fullTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** For a future timestamp — "in 3d", "in 2h", etc. Falls back to a date once it's more than a week out. */
export function timeUntil(ms: number): string {
  const s = Math.round((ms - Date.now()) / 1000);
  if (s <= 0) return "expired";
  if (s < 60) return "in less than a minute";
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `in ${d}d`;
  return `on ${new Date(ms).toLocaleDateString()}`;
}
