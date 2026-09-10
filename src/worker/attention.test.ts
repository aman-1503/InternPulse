import { describe, expect, it } from "vitest";
import { computeAttentionItems } from "./attention";
import type { Blocker, Mention, Reminder, Task, WeeklyReport } from "../shared/protocol";

const now = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function task(over: Partial<Task>): Task {
  return {
    id: "t1",
    title: "Task",
    description: null,
    status: "TODO",
    priority: null,
    dueDate: null,
    assigneeId: "u-intern",
    createdBy: "u-intern",
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function blocker(over: Partial<Blocker>): Blocker {
  return {
    id: "b1",
    taskId: null,
    description: "blocked",
    status: "OPEN",
    createdBy: "u-intern",
    createdByName: "Intern",
    createdAt: now,
    resolutionRequestedAt: null,
    resolutionRequestedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    resolvedByName: null,
    resolutionNote: null,
    mentorResponded: false,
    ...over,
  };
}

function report(over: Partial<WeeklyReport>): WeeklyReport {
  return {
    id: "r1",
    reportingPeriod: "2026-W10",
    status: "SUBMITTED",
    draftContent: "",
    finalContent: null,
    mentorFeedback: null,
    round: 0,
    aiGenerated: true,
    createdBy: "u-intern",
    createdAt: now,
    submittedAt: now,
    mentorReviewedAt: null,
    finalizedAt: null,
    overriddenBy: null,
    overriddenByName: null,
    ...over,
  };
}

const empty = { tasks: [] as Task[], blockers: [] as Blocker[], weeklyReports: [] as WeeklyReport[], mentions: [] as Mention[], reminders: [] as Reminder[], lastUpdateAt: null };

describe("computeAttentionItems", () => {
  it("intern sees an overdue task", () => {
    const items = computeAttentionItems({
      role: "intern",
      userId: "u-intern",
      now,
      ...empty,
      tasks: [task({ dueDate: now - DAY, status: "IN_PROGRESS" })],
    });
    expect(items.some((i) => i.reason === "TASK_OVERDUE")).toBe(true);
  });

  it("intern does not see another intern's overdue task", () => {
    const items = computeAttentionItems({
      role: "intern",
      userId: "u-intern",
      now,
      ...empty,
      tasks: [task({ dueDate: now - DAY, status: "IN_PROGRESS", assigneeId: "someone-else", createdBy: "someone-else" })],
    });
    expect(items.some((i) => i.reason === "TASK_OVERDUE")).toBe(false);
  });

  it("mentor sees a fresh unresponded blocker as WAITING_ON_YOU, not yet NO_RESPONSE", () => {
    const items = computeAttentionItems({
      role: "mentor",
      userId: "u-mentor",
      now,
      ...empty,
      blockers: [blocker({ createdAt: now - 5 * 60_000 })],
    });
    expect(items.some((i) => i.reason === "BLOCKER_WAITING_ON_YOU")).toBe(true);
    expect(items.some((i) => i.reason === "BLOCKER_NO_MENTOR_RESPONSE")).toBe(false);
  });

  it("mentor sees BLOCKER_NO_MENTOR_RESPONSE once the response window has passed", () => {
    const items = computeAttentionItems({
      role: "mentor",
      userId: "u-mentor",
      now,
      ...empty,
      blockers: [blocker({ createdAt: now - 2 * HOUR })],
    });
    expect(items.some((i) => i.reason === "BLOCKER_NO_MENTOR_RESPONSE")).toBe(true);
  });

  it("mentor sees nothing for a blocker they've already responded to", () => {
    const items = computeAttentionItems({
      role: "mentor",
      userId: "u-mentor",
      now,
      ...empty,
      blockers: [blocker({ createdAt: now - 2 * HOUR, mentorResponded: true })],
    });
    expect(items.some((i) => i.entityType === "BLOCKER")).toBe(false);
  });

  it("resolved blockers never surface for anyone", () => {
    for (const role of ["intern", "mentor", "manager"] as const) {
      const items = computeAttentionItems({
        role,
        userId: "u-x",
        now,
        ...empty,
        blockers: [blocker({ status: "RESOLVED", createdAt: now - 10 * DAY })],
      });
      expect(items.some((i) => i.entityType === "BLOCKER")).toBe(false);
    }
  });

  it("manager sees a long-unresolved blocker but not a fresh one", () => {
    const stale = computeAttentionItems({
      role: "manager",
      userId: "u-manager",
      now,
      ...empty,
      blockers: [blocker({ createdAt: now - 10 * HOUR })],
    });
    expect(stale.some((i) => i.reason === "BLOCKER_UNRESOLVED_TOO_LONG")).toBe(true);

    const fresh = computeAttentionItems({
      role: "manager",
      userId: "u-manager",
      now,
      ...empty,
      blockers: [blocker({ createdAt: now - 5 * 60_000 })],
    });
    expect(fresh.some((i) => i.reason === "BLOCKER_UNRESOLVED_TOO_LONG")).toBe(false);
  });

  it("mentor sees a SUBMITTED or RESUBMITTED report as ready for review", () => {
    const items = computeAttentionItems({
      role: "mentor",
      userId: "u-mentor",
      now,
      ...empty,
      weeklyReports: [report({ status: "RESUBMITTED" })],
    });
    expect(items.some((i) => i.reason === "REPORT_READY_FOR_REVIEW")).toBe(true);
  });

  it("intern sees CHANGES_REQUESTED only on their own report", () => {
    const mine = computeAttentionItems({
      role: "intern",
      userId: "u-intern",
      now,
      ...empty,
      weeklyReports: [report({ status: "CHANGES_REQUESTED", createdBy: "u-intern" })],
    });
    expect(mine.some((i) => i.reason === "REVIEW_CHANGES_REQUESTED")).toBe(true);

    const someoneElses = computeAttentionItems({
      role: "intern",
      userId: "u-intern",
      now,
      ...empty,
      weeklyReports: [report({ status: "CHANGES_REQUESTED", createdBy: "u-other" })],
    });
    expect(someoneElses.some((i) => i.reason === "REVIEW_CHANGES_REQUESTED")).toBe(false);
  });

  it("unread mentions surface for the mentioned user only, read ones don't", () => {
    const mention: Mention = {
      id: "m1",
      mentionedUserId: "u-intern",
      mentionedByName: "Mia",
      sourceType: "UPDATE",
      sourceId: "1",
      snippet: "hey",
      createdAt: now,
      readAt: null,
    };
    const unread = computeAttentionItems({ role: "intern", userId: "u-intern", now, ...empty, mentions: [mention] });
    expect(unread.some((i) => i.reason === "MENTIONED")).toBe(true);

    const read = computeAttentionItems({
      role: "intern",
      userId: "u-intern",
      now,
      ...empty,
      mentions: [{ ...mention, readAt: now }],
    });
    expect(read.some((i) => i.reason === "MENTIONED")).toBe(false);
  });
});
