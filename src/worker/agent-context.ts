/**
 * Pure helpers for the Progress Agent:
 *  - project authoritative WorkspaceDO state into a small, bounded AgentContext
 *  - render that context + conversation history into chat messages
 *  - a deterministic offline answer (AGENT_FAKE_AI) grounded in the same context
 *
 * No I/O, no persistence. WorkspaceDO SQLite remains the only source of truth;
 * this module never stores anything.
 */

import type {
  AgentContext,
  AgentGroundedOn,
  AgentTurn,
  Blocker,
  Feedback,
  ProgressUpdate,
  ActivityEntry,
  Role,
  Task,
} from "../shared/protocol";

// Bounds — keep the model input small and the cost predictable.
const LIMITS = {
  tasks: 40,
  openBlockers: 20,
  updates: 5,
  feedback: 5,
  activity: 15,
  historyTurns: 6,
  textField: 280,
  taskTitle: 120,
  contextChars: 3500,
} as const;

const DAY = 86_400_000;
const ageDays = (ts: number, now: number) => Math.max(0, Math.floor((now - ts) / DAY));
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const ACTIVITY_VERB: Record<ActivityEntry["type"], string> = {
  "task.created": "created task",
  "task.moved": "moved task",
  "task.completed": "completed task",
  "task.deleted": "deleted task",
  "blocker.raised": "raised a blocker",
  "blocker.resolved": "resolved a blocker",
  "update.posted": "posted an update",
  "feedback.posted": "posted feedback",
};

export function projectAgentContext(input: {
  workspaceId: string;
  requesterName: string;
  role: Role | null;
  tasks: Task[];
  blockers: Blocker[];
  updates: ProgressUpdate[];
  feedback: Feedback[];
  activity: ActivityEntry[];
  now?: number;
}): AgentContext {
  const now = input.now ?? Date.now();
  const taskTitleById = new Map(input.tasks.map((t) => [t.id, t.title]));

  const active = input.tasks.filter((t) => t.status !== "DONE");
  const doneTaskCount = input.tasks.length - active.length;
  const shownTasks = active.slice(0, LIMITS.tasks);

  const openBlockers = input.blockers.filter((b) => b.status === "OPEN");
  const resolvedBlockerCount = input.blockers.length - openBlockers.length;

  return {
    workspaceId: input.workspaceId,
    generatedAt: now,
    requester: { displayName: input.requesterName, role: input.role },
    tasks: shownTasks.map((t) => ({
      title: clip(t.title, LIMITS.taskTitle),
      status: t.status,
      priority: t.priority,
      assigneeId: t.assigneeId,
      ageDays: ageDays(t.createdAt, now),
    })),
    doneTaskCount,
    truncatedTasks: Math.max(0, active.length - shownTasks.length),
    openBlockers: openBlockers.slice(0, LIMITS.openBlockers).map((b) => ({
      description: clip(b.description, LIMITS.textField),
      taskTitle: b.taskId ? (taskTitleById.get(b.taskId) ?? null) : null,
      ageDays: ageDays(b.createdAt, now),
    })),
    resolvedBlockerCount,
    recentUpdates: input.updates.slice(0, LIMITS.updates).map((u) => ({
      authorName: u.authorName,
      type: u.type,
      content: clip(u.content, LIMITS.textField),
      ageDays: ageDays(u.createdAt, now),
    })),
    recentFeedback: input.feedback.slice(0, LIMITS.feedback).map((f) => ({
      authorName: f.authorName,
      content: clip(f.content, LIMITS.textField),
      ageDays: ageDays(f.createdAt, now),
    })),
    recentActivity: input.activity.slice(0, LIMITS.activity).map((a) => {
      const meta = a.metadata ?? {};
      const title = typeof meta.title === "string" ? ` "${clip(meta.title, 60)}"` : "";
      const status = typeof meta.status === "string" ? ` -> ${meta.status}` : "";
      return `${ageDays(a.createdAt, now)}d ago: ${a.actorName} ${ACTIVITY_VERB[a.type] ?? a.type}${title}${status}`;
    }),
  };
}

export function groundedOn(ctx: AgentContext): AgentGroundedOn {
  return {
    activeTasks: ctx.tasks.length + ctx.truncatedTasks,
    doneTasks: ctx.doneTaskCount,
    openBlockers: ctx.openBlockers.length,
    updates: ctx.recentUpdates.length,
    feedback: ctx.recentFeedback.length,
    activity: ctx.recentActivity.length,
    contextGeneratedAt: ctx.generatedAt,
  };
}

/** Deterministic text rendering of the context; also reused by the offline stub. */
export function renderContextBlock(ctx: AgentContext): string {
  const lines: string[] = [];
  lines.push(`Workspace: ${ctx.workspaceId}`);
  lines.push(
    `Requester: ${ctx.requester.displayName} (role: ${ctx.requester.role ?? "observer"})`,
  );

  lines.push("");
  lines.push(`ACTIVE TASKS (${ctx.tasks.length}${ctx.truncatedTasks ? ` of ${ctx.tasks.length + ctx.truncatedTasks}` : ""}):`);
  if (ctx.tasks.length === 0) lines.push("  (none)");
  for (const t of ctx.tasks) {
    lines.push(
      `  - [${t.status}]${t.priority ? ` (${t.priority})` : ""} ${t.title} — ${t.ageDays}d old${t.assigneeId ? `, assignee ${t.assigneeId}` : ""}`,
    );
  }
  lines.push(`COMPLETED TASKS: ${ctx.doneTaskCount}`);

  lines.push("");
  lines.push(`OPEN BLOCKERS (${ctx.openBlockers.length}):`);
  if (ctx.openBlockers.length === 0) lines.push("  (none)");
  for (const b of ctx.openBlockers) {
    lines.push(
      `  - ${b.description}${b.taskTitle ? ` [task: ${b.taskTitle}]` : ""} — open ${b.ageDays}d`,
    );
  }
  lines.push(`RESOLVED BLOCKERS (recent): ${ctx.resolvedBlockerCount}`);

  lines.push("");
  lines.push(`RECENT UPDATES (${ctx.recentUpdates.length}):`);
  if (ctx.recentUpdates.length === 0) lines.push("  (none)");
  for (const u of ctx.recentUpdates) {
    lines.push(`  - ${u.authorName} (${u.type}, ${u.ageDays}d ago): ${u.content}`);
  }

  lines.push("");
  lines.push(`RECENT MENTOR FEEDBACK (${ctx.recentFeedback.length}):`);
  if (ctx.recentFeedback.length === 0) lines.push("  (none)");
  for (const f of ctx.recentFeedback) {
    lines.push(`  - ${f.authorName} (${f.ageDays}d ago): ${f.content}`);
  }

  lines.push("");
  lines.push(`RECENT ACTIVITY (${ctx.recentActivity.length}):`);
  if (ctx.recentActivity.length === 0) lines.push("  (none)");
  for (const a of ctx.recentActivity) lines.push(`  - ${a}`);

  let block = lines.join("\n");
  if (block.length > LIMITS.contextChars) {
    block = block.slice(0, LIMITS.contextChars) + "\n… (context truncated)";
  }
  return block;
}

const ROLE_FRAMING: Record<"intern" | "mentor" | "manager" | "observer", string> = {
  intern:
    "The requester is the INTERN. Speak to them directly ('you'). Focus on their current priorities, what is blocking them, and how to prepare for mentor conversations.",
  mentor:
    "The requester is the MENTOR. Refer to the intern in the third person. Highlight blockers that need mentor input, work that looks stuck, and areas needing attention.",
  manager:
    "The requester is the MANAGER. Give a concise project-level view: progress, unresolved blockers, pending work. Do not make performance judgements or rate anyone.",
  observer:
    "The requester has no assigned role. Give a neutral, factual summary of workspace state.",
};

export function buildMessages(
  ctx: AgentContext,
  userPrompt: string,
  history: AgentTurn[],
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const roleKey = ctx.requester.role ?? "observer";
  const system = [
    "You are the InternPulse Progress Agent for one internship/project workspace.",
    "Answer ONLY from the WORKSPACE STATE provided below. If the data does not contain the answer, say so plainly.",
    "Never invent tasks, blockers, updates, feedback, names, dates, or numbers.",
    "You cannot change anything: never claim you created, moved, completed, deleted, assigned, resolved, escalated, notified, or reported. You may SUGGEST such actions for a human to take.",
    "Do not produce performance ratings, rankings, or sentiment scores.",
    "Be concise: a short paragraph or a few bullet points.",
    ROLE_FRAMING[roleKey],
    "",
    "WORKSPACE STATE (authoritative, generated just now):",
    renderContextBlock(ctx),
  ].join("\n");

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
  ];
  for (const turn of history.slice(-LIMITS.historyTurns)) {
    messages.push({ role: "user", content: clip(turn.prompt, 500) });
    messages.push({ role: "assistant", content: clip(turn.answer, 800) });
  }
  messages.push({ role: "user", content: userPrompt });
  return messages;
}

/**
 * Deterministic, offline answer used when AGENT_FAKE_AI=1 or env.AI is missing.
 * It is grounded in the real context so tests can assert on actual state.
 */
export function fakeAnswer(ctx: AgentContext, userPrompt: string): string {
  const p = userPrompt.toLowerCase();
  const who = ctx.requester.role ?? "observer";
  const subject = who === "intern" ? "You have" : who === "mentor" ? "The intern has" : "The project has";
  const activeCount = ctx.tasks.length + ctx.truncatedTasks;

  const parts: string[] = [`[offline stub · no model called]`];

  if (p.includes("block")) {
    if (ctx.openBlockers.length === 0) {
      parts.push(`${subject} no open blockers right now.`);
    } else {
      parts.push(`${subject} ${ctx.openBlockers.length} open blocker(s):`);
      for (const b of ctx.openBlockers) {
        parts.push(`• ${b.description}${b.taskTitle ? ` (task: ${b.taskTitle})` : ""} — open ${b.ageDays}d`);
      }
      if (who === "intern") parts.push("Consider raising these with your mentor.");
    }
    return parts.join("\n");
  }

  if (p.includes("mentor") || p.includes("discuss") || p.includes("1:1") || p.includes("one on one")) {
    parts.push("Suggested discussion points with your mentor:");
    if (ctx.openBlockers.length) parts.push(`• ${ctx.openBlockers.length} unresolved blocker(s), incl. "${ctx.openBlockers[0].description}"`);
    const stuck = ctx.tasks.filter((t) => t.status === "BLOCKED" || t.ageDays >= 7);
    if (stuck.length) parts.push(`• Tasks that look stuck: ${stuck.map((t) => t.title).join(", ")}`);
    if (ctx.recentFeedback.length) parts.push(`• Follow-up on recent feedback from ${ctx.recentFeedback[0].authorName}`);
    if (parts.length === 2) parts.push("• No blockers or stuck tasks — share your recent progress and next steps.");
    return parts.join("\n");
  }

  if (p.includes("recent") || p.includes("chang") || p.includes("accomplish") || p.includes("week")) {
    parts.push(`Recent activity (${ctx.recentActivity.length} events):`);
    for (const a of ctx.recentActivity.slice(0, 8)) parts.push(`• ${a}`);
    if (ctx.recentUpdates[0]) parts.push(`Latest update — ${ctx.recentUpdates[0].authorName}: ${ctx.recentUpdates[0].content}`);
    if (ctx.recentActivity.length === 0) parts.push("• No activity recorded yet.");
    return parts.join("\n");
  }

  // default: project summary
  parts.push(
    `${subject} ${activeCount} active task(s) and ${ctx.doneTaskCount} completed; ${ctx.openBlockers.length} open blocker(s).`,
  );
  const byStatus: Record<string, number> = {};
  for (const t of ctx.tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  const brk = Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(", ");
  if (brk) parts.push(`Active breakdown: ${brk}.`);
  if (ctx.openBlockers[0]) parts.push(`Top blocker: ${ctx.openBlockers[0].description}.`);
  if (ctx.recentUpdates[0]) parts.push(`Latest update: ${ctx.recentUpdates[0].content}`);
  if (ctx.recentFeedback[0]) parts.push(`Latest feedback (${ctx.recentFeedback[0].authorName}): ${ctx.recentFeedback[0].content}`);
  return parts.join("\n");
}
