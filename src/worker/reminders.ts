/**
 * Pure helpers for Phase 4B: deterministic reminder / escalation / weekly-draft
 * text used whenever Workers AI is unavailable, plus a small period helper.
 * No I/O.
 */

import type { AgentContext, Blocker } from "../shared/protocol";

/** ISO-8601 week string, e.g. "2026-W37". Stable, human-readable reporting period. */
export function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const ageDays = (ts: number) => Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));

/** Deterministic reminder wording (AI-free). */
export function blockerReminderText(
  blocker: Blocker,
  audience: "intern" | "mentor",
): string {
  const age = ageDays(blocker.createdAt);
  const desc = blocker.description.length > 200 ? blocker.description.slice(0, 199) + "…" : blocker.description;
  if (audience === "intern") {
    return `Your blocker is still open after ${age}d: "${desc}". If anything changed, post an update; otherwise flag it to your mentor.`;
  }
  return `An intern blocker has been waiting ${age}d for attention: "${desc}". Please review and help unblock or resolve it.`;
}

export function blockerEscalationText(blocker: Blocker): string {
  const age = ageDays(blocker.createdAt);
  const desc = blocker.description.length > 200 ? blocker.description.slice(0, 199) + "…" : blocker.description;
  return `Escalation: a blocker has stayed unresolved for ${age}d past the escalation threshold: "${desc}". Manager visibility requested.`;
}

/**
 * Deterministic weekly draft built straight from structured current state.
 * Clearly marked so nobody mistakes it for an AI-written report.
 */
export function deterministicWeeklyDraft(period: string, ctx: AgentContext): string {
  const lines: string[] = [];
  lines.push(`# Weekly progress — ${period}`);
  lines.push("");
  lines.push("> Auto-generated from workspace data (AI unavailable). Please review and edit before submitting.");
  lines.push("");

  const done = ctx.doneTaskCount;
  const active = ctx.tasks;
  lines.push(`## Completed`);
  lines.push(done > 0 ? `- ${done} task(s) marked done this period.` : "- Nothing marked done yet.");
  lines.push("");

  lines.push(`## In progress (${active.length})`);
  if (active.length === 0) lines.push("- No active tasks.");
  for (const t of active.slice(0, 15)) {
    lines.push(`- [${t.status}]${t.priority ? ` (${t.priority})` : ""} ${t.title}`);
  }
  lines.push("");

  lines.push(`## Current open blockers (${ctx.openBlockers.length})`);
  if (ctx.openBlockers.length === 0) lines.push("- None currently open.");
  for (const b of ctx.openBlockers) lines.push(`- ${b.description} (open ${b.ageDays}d)`);
  lines.push("");

  lines.push(`## Recent updates`);
  if (ctx.recentUpdates.length === 0) lines.push("- No updates posted.");
  for (const u of ctx.recentUpdates) lines.push(`- ${u.authorName} (${u.type}): ${u.content}`);
  lines.push("");

  lines.push(`## Recent mentor feedback`);
  if (ctx.recentFeedback.length === 0) lines.push("- None.");
  for (const f of ctx.recentFeedback) lines.push(`- ${f.authorName}: ${f.content}`);

  return lines.join("\n");
}
