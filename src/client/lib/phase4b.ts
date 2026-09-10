import type { Reminder, WeeklyReport, WeeklyReviewDecision } from "../../shared/protocol";

interface Identity {
  userId: string;
  displayName: string;
}

function qs(identity: Identity, devRole: string): string {
  const p = new URLSearchParams({ userId: identity.userId, displayName: identity.displayName });
  if (devRole) p.set("devRole", devRole);
  return p.toString();
}

const base = (workspaceId: string) => `/api/workspace/${encodeURIComponent(workspaceId)}`;

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error || `request failed (${res.status})`);
  return body as T;
}

// -- reminders --------------------------------------------------------

export function acknowledgeReminder(
  workspaceId: string,
  identity: Identity,
  devRole: string,
  reminderId: string,
): Promise<{ reminder: Reminder }> {
  return req(`${base(workspaceId)}/reminders/${reminderId}/ack?${qs(identity, devRole)}`, {
    method: "POST",
  });
}

// -- weekly review ---------------------------------------------------

export function startWeeklyReview(
  workspaceId: string,
  identity: Identity,
  devRole: string,
): Promise<{ report: WeeklyReport }> {
  return req(`${base(workspaceId)}/weekly?${qs(identity, devRole)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

export function saveWeeklyDraft(
  workspaceId: string,
  identity: Identity,
  devRole: string,
  reportId: string,
  draftContent: string,
): Promise<{ report: WeeklyReport }> {
  return req(`${base(workspaceId)}/weekly/${reportId}?${qs(identity, devRole)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draftContent }),
  });
}

export function submitWeeklyReport(
  workspaceId: string,
  identity: Identity,
  devRole: string,
  reportId: string,
): Promise<{ ok: true }> {
  return req(`${base(workspaceId)}/weekly/${reportId}/submit?${qs(identity, devRole)}`, {
    method: "POST",
  });
}

export function reviewWeeklyReport(
  workspaceId: string,
  identity: Identity,
  devRole: string,
  reportId: string,
  decision: WeeklyReviewDecision,
  feedback?: string,
): Promise<{ ok: true }> {
  return req(`${base(workspaceId)}/weekly/${reportId}/review?${qs(identity, devRole)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, feedback }),
  });
}

/** Manager overrides a stuck mentor review. Recorded in the report's audit fields. */
export function overrideWeeklyReport(
  workspaceId: string,
  identity: Identity,
  devRole: string,
  reportId: string,
  decision: WeeklyReviewDecision,
  note: string,
): Promise<{ ok: true }> {
  return req(`${base(workspaceId)}/weekly/${reportId}/override?${qs(identity, devRole)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, note }),
  });
}
