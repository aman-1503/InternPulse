import type { AttentionItem, AttentionReason } from "../../shared/protocol";
import type { Membership } from "../auth/types";
import type { PortfolioEntry } from "../lib/usePortfolio";

export interface AttentionRow {
  item: AttentionItem;
  workspaceId: string;
  workspaceName: string;
}

/** Flattens every workspace's already role-curated attentionItems into one navigable list. */
export function flattenAttention(entries: PortfolioEntry[]): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const entry of entries) {
    if (!entry.snapshot) continue;
    for (const item of entry.snapshot.attentionItems) {
      rows.push({ item, workspaceId: entry.membership.workspaceId, workspaceName: entry.membership.workspaceName });
    }
  }
  return rows.sort((a, b) => b.item.createdAt - a.item.createdAt);
}

export function byReasons(rows: AttentionRow[], reasons: AttentionReason[]): AttentionRow[] {
  const set = new Set(reasons);
  return rows.filter((r) => set.has(r.item.reason));
}

export const REASON_LABEL: Record<AttentionReason, string> = {
  REVIEW_CHANGES_REQUESTED: "Weekly review needs changes",
  MENTIONED: "You were mentioned",
  TASK_URGENT_DUE_TODAY: "Urgent task due today",
  TASK_OVERDUE: "Task overdue",
  BLOCKER_RESOLUTION_REJECTED: "Blocker resolution rejected",
  BLOCKER_WAITING_ON_YOU: "Blocker waiting on you",
  BLOCKER_NO_MENTOR_RESPONSE: "No mentor response yet",
  REPORT_READY_FOR_REVIEW: "Weekly report ready for review",
  URGENT_TASK_NEEDS_GUIDANCE: "Urgent task needs guidance",
  INTERN_STALE: "No recent progress",
  BLOCKER_UNRESOLVED_TOO_LONG: "Blocker unresolved too long",
  URGENT_TASK_STILL_BLOCKED: "Urgent task still blocked",
  MENTOR_REVIEW_OVERDUE: "Mentor review overdue",
  REPORT_WAITING_TOO_LONG: "Report waiting too long",
  ESCALATION: "Escalated",
};

export function findMembership(memberships: Membership[], workspaceId: string): Membership | undefined {
  return memberships.find((m) => m.workspaceId === workspaceId);
}
