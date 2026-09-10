/**
 * Role-curated "needs attention" engine. Never a second source of truth —
 * every item here is re-derived from the DO's current SQLite state (tasks,
 * blockers, weekly reports, mentions, reminders) each time it is computed,
 * matching the same "current state over historical" rule the Progress Agent
 * follows. Nothing is persisted by this module.
 */

import type {
  AttentionItem,
  AttentionReason,
  Blocker,
  Mention,
  Reminder,
  Role,
  Task,
  WeeklyReport,
} from "../shared/protocol";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Demo-scale thresholds — short enough to observe in a live walkthrough.
const MENTOR_RESPONSE_SLOW = 1 * HOUR;
const BLOCKER_UNRESOLVED_LONG = 6 * HOUR;
const REVIEW_OVERDUE = 2 * HOUR;
const REVIEW_WAITING_TOO_LONG = 12 * HOUR;
const STALE_INTERN = 2 * DAY;

interface ComputeInput {
  role: Role;
  userId: string;
  now: number;
  tasks: Task[];
  blockers: Blocker[];
  weeklyReports: WeeklyReport[];
  mentions: Mention[];
  reminders: Reminder[];
  /** createdAt of the most recent update.create by this intern, if any. */
  lastUpdateAt: number | null;
}

let counter = 0;
function id(reason: AttentionReason, entityId: string): string {
  counter += 1;
  return `att_${reason}_${entityId}_${counter}`;
}

function isMine(task: Task, userId: string): boolean {
  return task.assigneeId === userId || (task.assigneeId === null && task.createdBy === userId);
}

export function computeAttentionItems(input: ComputeInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { role, userId, now } = input;

  const pushMentions = () => {
    for (const m of input.mentions) {
      if (m.readAt) continue;
      items.push({
        id: id("MENTIONED", m.id),
        recipientUserId: userId,
        recipientRole: role,
        reason: "MENTIONED",
        title: `${m.mentionedByName} mentioned you`,
        message: m.snippet,
        entityType: "MENTION",
        entityId: m.id,
        createdAt: m.createdAt,
        navigate: navigateForSource(m.sourceType, m.sourceId),
      });
    }
  };

  if (role === "intern") {
    for (const r of input.weeklyReports) {
      if (r.createdBy === userId && r.status === "CHANGES_REQUESTED") {
        items.push({
          id: id("REVIEW_CHANGES_REQUESTED", r.id),
          recipientUserId: userId,
          recipientRole: role,
          reason: "REVIEW_CHANGES_REQUESTED",
          title: "Mentor requested changes to your weekly review",
          message: r.mentorFeedback ?? "See the weekly tab for details.",
          entityType: "WEEKLY_REPORT",
          entityId: r.id,
          createdAt: r.mentorReviewedAt ?? r.createdAt,
          navigate: { tab: "weekly", entityId: r.id },
        });
      }
    }
    for (const t of input.tasks) {
      if (!isMine(t, userId) || t.status === "DONE" || !t.dueDate) continue;
      const startOfToday = new Date(now).setHours(0, 0, 0, 0);
      const endOfToday = startOfToday + DAY;
      if (t.dueDate < now) {
        items.push(taskItem("TASK_OVERDUE", t, `"${t.title}" is overdue`, `Due ${new Date(t.dueDate).toLocaleDateString()}`, role, userId));
      } else if (t.priority === "URGENT" && t.dueDate >= startOfToday && t.dueDate < endOfToday) {
        items.push(taskItem("TASK_URGENT_DUE_TODAY", t, `URGENT task "${t.title}" due today`, "Due today", role, userId));
      }
    }
    pushMentions();
  }

  if (role === "mentor") {
    for (const b of input.blockers) {
      if (b.status === "RESOLVED") continue;
      const age = now - b.createdAt;
      if (!b.mentorResponded) {
        items.push(
          blockerItem(
            age > MENTOR_RESPONSE_SLOW ? "BLOCKER_NO_MENTOR_RESPONSE" : "BLOCKER_WAITING_ON_YOU",
            b,
            age > MENTOR_RESPONSE_SLOW
              ? `Blocker still has no mentor response (${formatAge(age)})`
              : `${b.createdByName || "An intern"} raised a blocker and is waiting`,
            b.description,
            role,
            userId,
          ),
        );
      }
    }
    for (const r of input.weeklyReports) {
      if (r.status === "SUBMITTED" || r.status === "RESUBMITTED") {
        items.push({
          id: id("REPORT_READY_FOR_REVIEW", r.id),
          recipientUserId: userId,
          recipientRole: role,
          reason: "REPORT_READY_FOR_REVIEW",
          title: "Weekly report ready for review",
          message: `Reporting period ${r.reportingPeriod}`,
          entityType: "WEEKLY_REPORT",
          entityId: r.id,
          createdAt: r.submittedAt ?? r.createdAt,
          navigate: { tab: "weekly", entityId: r.id },
        });
      }
    }
    for (const t of input.tasks) {
      if (t.status === "BLOCKED" && (t.priority === "URGENT" || t.priority === "HIGH")) {
        items.push(taskItem("URGENT_TASK_NEEDS_GUIDANCE", t, `${t.priority} task "${t.title}" is blocked`, "Needs your guidance", role, userId));
      }
    }
    if (input.lastUpdateAt !== null && now - input.lastUpdateAt > STALE_INTERN) {
      items.push({
        id: id("INTERN_STALE", "intern"),
        recipientUserId: userId,
        recipientRole: role,
        reason: "INTERN_STALE",
        title: "No recent updates from your intern",
        message: `Last update ${formatAge(now - input.lastUpdateAt)} ago`,
        entityType: "TASK",
        entityId: "",
        createdAt: input.lastUpdateAt,
        navigate: { tab: "overview", entityId: null },
      });
    }
    pushMentions();
  }

  if (role === "manager") {
    for (const b of input.blockers) {
      if (b.status === "RESOLVED") continue;
      const age = now - b.createdAt;
      const urgentLinked = false; // linked-task priority is joined by the caller via reminders when needed
      if (age > BLOCKER_UNRESOLVED_LONG || urgentLinked) {
        items.push(blockerItem("BLOCKER_UNRESOLVED_TOO_LONG", b, `Blocker unresolved for ${formatAge(age)}`, b.description, role, userId));
      }
    }
    for (const t of input.tasks) {
      if (t.status === "BLOCKED" && (t.priority === "URGENT" || t.priority === "HIGH")) {
        items.push(taskItem("URGENT_TASK_STILL_BLOCKED", t, `${t.priority} task "${t.title}" is still blocked`, "Blocked and high priority", role, userId));
      }
    }
    for (const r of input.weeklyReports) {
      if (r.status !== "SUBMITTED" && r.status !== "RESUBMITTED") continue;
      const age = now - (r.submittedAt ?? r.createdAt);
      if (age > REVIEW_WAITING_TOO_LONG) {
        items.push({
          id: id("REPORT_WAITING_TOO_LONG", r.id),
          recipientUserId: userId,
          recipientRole: role,
          reason: "REPORT_WAITING_TOO_LONG",
          title: `Weekly report waiting ${formatAge(age)}`,
          message: "Consider overriding if the mentor is unavailable.",
          entityType: "WEEKLY_REPORT",
          entityId: r.id,
          createdAt: r.submittedAt ?? r.createdAt,
          navigate: { tab: "weekly", entityId: r.id },
        });
      } else if (age > REVIEW_OVERDUE) {
        items.push({
          id: id("MENTOR_REVIEW_OVERDUE", r.id),
          recipientUserId: userId,
          recipientRole: role,
          reason: "MENTOR_REVIEW_OVERDUE",
          title: "Mentor review overdue",
          message: `Reporting period ${r.reportingPeriod}`,
          entityType: "WEEKLY_REPORT",
          entityId: r.id,
          createdAt: r.submittedAt ?? r.createdAt,
          navigate: { tab: "weekly", entityId: r.id },
        });
      }
    }
    for (const rem of input.reminders) {
      if (rem.type === "BLOCKER_ESCALATION" && rem.status === "OPEN") {
        items.push({
          id: id("ESCALATION", rem.id),
          recipientUserId: userId,
          recipientRole: role,
          reason: "ESCALATION",
          title: "Escalation",
          message: rem.message,
          entityType: "BLOCKER",
          entityId: rem.entityId,
          createdAt: rem.createdAt,
          navigate: { tab: "blockers", entityId: rem.entityId },
        });
      }
    }
    pushMentions();
  }

  return items.sort((a, b) => b.createdAt - a.createdAt);
}

function taskItem(
  reason: AttentionReason,
  t: Task,
  title: string,
  message: string,
  role: Role,
  userId: string,
): AttentionItem {
  return {
    id: id(reason, t.id),
    recipientUserId: userId,
    recipientRole: role,
    reason,
    title,
    message,
    entityType: "TASK",
    entityId: t.id,
    createdAt: t.updatedAt,
    navigate: { tab: "board" as const, entityId: t.id },
  };
}

function blockerItem(
  reason: AttentionReason,
  b: Blocker,
  title: string,
  message: string,
  role: Role,
  userId: string,
): AttentionItem {
  return {
    id: id(reason, b.id),
    recipientUserId: userId,
    recipientRole: role,
    reason,
    title,
    message,
    entityType: "BLOCKER",
    entityId: b.id,
    createdAt: b.createdAt,
    navigate: { tab: "blockers", entityId: b.id },
  };
}

function navigateForSource(sourceType: Mention["sourceType"], sourceId: string) {
  switch (sourceType) {
    case "BLOCKER_COMMENT":
      return { tab: "blockers" as const, entityId: sourceId };
    case "WEEKLY_REVIEW":
      return { tab: "weekly" as const, entityId: sourceId };
    case "UPDATE":
      return { tab: "overview" as const, entityId: sourceId };
    default:
      return { tab: "feedback" as const, entityId: sourceId };
  }
}

function formatAge(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60000))}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  return `${Math.round(ms / DAY)}d`;
}
