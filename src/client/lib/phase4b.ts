import type { Reminder, WeeklyReport, WeeklyReviewDecision } from "../../shared/protocol";
import { identityQuery, withQuery, workspaceBase, workspaceJson, type WorkspaceMode } from "./workspaceApi";

function url(workspaceId: string, mode: WorkspaceMode, path: string): string {
  return withQuery(`${workspaceBase(workspaceId, mode)}${path}`, identityQuery(mode));
}

// -- reminders --------------------------------------------------------

export function acknowledgeReminder(
  workspaceId: string,
  mode: WorkspaceMode,
  reminderId: string,
): Promise<{ reminder: Reminder }> {
  return workspaceJson(url(workspaceId, mode, `/reminders/${reminderId}/ack`), { method: "POST" });
}

// -- weekly review ---------------------------------------------------

export function startWeeklyReview(workspaceId: string, mode: WorkspaceMode): Promise<{ report: WeeklyReport }> {
  return workspaceJson(url(workspaceId, mode, "/weekly"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

export function saveWeeklyDraft(
  workspaceId: string,
  mode: WorkspaceMode,
  reportId: string,
  draftContent: string,
): Promise<{ report: WeeklyReport }> {
  return workspaceJson(url(workspaceId, mode, `/weekly/${reportId}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draftContent }),
  });
}

export function submitWeeklyReport(workspaceId: string, mode: WorkspaceMode, reportId: string): Promise<{ ok: true }> {
  return workspaceJson(url(workspaceId, mode, `/weekly/${reportId}/submit`), { method: "POST" });
}

export function reviewWeeklyReport(
  workspaceId: string,
  mode: WorkspaceMode,
  reportId: string,
  decision: WeeklyReviewDecision,
  feedback?: string,
): Promise<{ ok: true }> {
  return workspaceJson(url(workspaceId, mode, `/weekly/${reportId}/review`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, feedback }),
  });
}

/** Manager overrides a stuck mentor review. Recorded in the report's audit fields. */
export function overrideWeeklyReport(
  workspaceId: string,
  mode: WorkspaceMode,
  reportId: string,
  decision: WeeklyReviewDecision,
  note: string,
): Promise<{ ok: true }> {
  return workspaceJson(url(workspaceId, mode, `/weekly/${reportId}/override`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, note }),
  });
}
