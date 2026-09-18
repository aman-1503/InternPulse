/**
 * Single seam for "which workspace API namespace, and how is identity
 * conveyed" — production vs. demo. Every workspace-scoped client (WS,
 * agent, attachments, weekly/reminders) is parameterized by a `WorkspaceMode`
 * instead of duplicating a demo and a production copy of each file.
 *
 * Production mode sends NO identity query params at all — the server derives
 * identity entirely from the verified Cloudflare Access assertion (see
 * src/worker/access-auth.ts). Demo mode is the pre-existing unauthenticated
 * query-param mechanism, scoped server-side to is_demo=1 workspaces only.
 */
export type WorkspaceMode =
  | { kind: "production" }
  | { kind: "demo"; userId: string; displayName: string; devRole?: string | null };

export function workspaceBase(workspaceId: string, mode: WorkspaceMode): string {
  const id = encodeURIComponent(workspaceId);
  return mode.kind === "demo" ? `/api/demo/workspace/${id}` : `/api/workspace/${id}`;
}

/** Query string for demo identity, or "" for production (nothing to send). */
export function identityQuery(mode: WorkspaceMode): string {
  if (mode.kind !== "demo") return "";
  const p = new URLSearchParams({ userId: mode.userId, displayName: mode.displayName });
  if (mode.devRole) p.set("devRole", mode.devRole);
  return p.toString();
}

export function withQuery(url: string, qs: string): string {
  return qs ? `${url}?${qs}` : url;
}

export async function workspaceJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error || `request failed (${res.status})`);
  return body as T;
}
