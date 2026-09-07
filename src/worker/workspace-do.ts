import { DurableObject } from "cloudflare:workers";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  UPDATE_TYPES,
  WS_PROTOCOL_VERSION,
  type ClientMessage,
  type PresenceMember,
  type PresenceState,
  type Role,
  type ServerMessage,
  type TaskPatch,
  type TaskPriority,
  type TaskStatus,
  type UpdateType,
  type WorkspaceSnapshot,
} from "../shared/protocol";
import { canMutate } from "./permissions";
import { projectAgentContext } from "./agent-context";
import { blockerText, feedbackText, updateText } from "./history-index";
import { WorkspaceStore } from "./workspace-store";
import type {
  AgentContext,
  Attachment,
  AttachmentIndexStatus,
  Blocker,
  HistoryIndexEvent,
  IndexableEntity,
  IndexableEntityType,
  Reminder,
  ReminderEntityType,
  ReminderType,
  WeeklyReport,
  WeeklyReportStatus,
  WorkflowEventMessage,
} from "../shared/protocol";

/** Per-connection identity + role + workspace. Stored on the hibernatable socket. */
interface SocketAttachment {
  userId: string;
  displayName: string;
  role: Role | null;
  workspaceId: string;
}

const MAX = {
  title: 200,
  description: 2000,
  blocker: 1000,
  update: 4000,
  feedback: 4000,
} as const;

/** A client-facing validation/permission failure. Never a 500. */
class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One instance per internship/project workspace. The Worker routes to it via
 * `env.WORKSPACE_DO.idFromName(workspaceId)` and forwards a Worker-authoritative
 * identity (`_uid` / `_name` / `_role`) that the DO trusts. The DO owns all
 * workspace-local state (SQLite) and is the single source of truth; clients
 * receive an authoritative snapshot on connect and follow realtime mutations.
 */
export class WorkspaceDO extends DurableObject<Env> {
  private readonly store: WorkspaceStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new WorkspaceStore(ctx.storage.sql);
  }

  // -- HTTP (forwarded from the Worker) --------------------------------

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.handleWebSocketUpgrade(url);
    }

    // JSON endpoints, used by the manager overview and backend tests.
    if (url.pathname.endsWith("/summary")) {
      return Response.json(this.store.summaryStats());
    }
    if (url.pathname.endsWith("/snapshot")) {
      return Response.json(this.buildSnapshot(url, this.readIdentity(url)));
    }

    return new Response("Not found", { status: 404 });
  }

  // -- RPC (called only by the ProgressAgent, DO-to-DO, no HTTP) ------

  /**
   * Read-only, bounded projection of authoritative workspace state for the
   * Progress Agent. Rebuilt from SQLite on every call, so the agent always
   * reasons over current state. `role` is passed through from the Worker's
   * authorization boundary; this method is not reachable from the public API.
   */
  async getAgentContext(
    workspaceId: string,
    role: Role | null,
    requesterName: string,
  ): Promise<AgentContext> {
    return projectAgentContext({
      workspaceId,
      requesterName,
      role,
      tasks: this.store.listTasks(),
      blockers: this.store.listBlockers(),
      updates: this.store.listUpdates(),
      feedback: this.store.listFeedback(),
      activity: this.store.listActivity(),
    });
  }

  /**
   * Phase 4A: current authoritative text + minimal metadata for one indexable
   * entity, re-read fresh so the history index never embeds stale data. Returns
   * `null` if the entity was deleted or is otherwise not indexable — the queue
   * consumer then removes any stale vector rather than inventing data.
   */
  async getIndexableEntity(
    workspaceId: string,
    entityType: IndexableEntityType,
    entityId: string,
  ): Promise<IndexableEntity | null> {
    if (entityType === "UPDATE") {
      const id = Number(entityId);
      const u = Number.isFinite(id) ? this.store.getUpdate(id) : null;
      if (!u) return null;
      return {
        workspaceId,
        entityType,
        entityId,
        text: updateText(u),
        authorId: u.authorId,
        createdAt: u.createdAt,
        status: u.type,
      };
    }
    if (entityType === "BLOCKER") {
      const b = this.store.getBlocker(entityId);
      if (!b) return null;
      return {
        workspaceId,
        entityType,
        entityId,
        text: blockerText(b),
        authorId: b.createdBy,
        createdAt: b.createdAt,
        status: b.status,
      };
    }
    const f = this.store.getFeedback(entityId);
    if (!f) return null;
    return {
      workspaceId,
      entityType,
      entityId,
      text: feedbackText(f),
      authorId: f.authorId,
      createdAt: f.createdAt,
      status: null,
    };
  }

  // -- RPC: Phase 4B workflows (BlockerWorkflow / WeeklyReviewWorkflow) ---
  // Workflows re-read authoritative state through these on every step; they
  // never trust their own payloads. Not reachable from the public API.

  async getBlocker(blockerId: string): Promise<Blocker | null> {
    return this.store.getBlocker(blockerId);
  }

  async createReminder(input: {
    recipientUserId: string | null;
    recipientRole: Role;
    type: ReminderType;
    entityType: ReminderEntityType;
    entityId: string;
    message: string;
  }): Promise<{ reminder: Reminder | null; created: boolean }> {
    const reminder = this.store.createReminder(input);
    if (reminder) this.broadcast({ type: "reminder.created", reminder });
    return { reminder, created: reminder !== null };
  }

  async listReminders(userId: string, role: Role | null): Promise<Reminder[]> {
    return this.store.listRemindersFor(userId, role);
  }

  async acknowledgeReminder(
    id: string,
    userId: string,
    role: Role | null,
  ): Promise<Reminder | null> {
    const reminder = this.store.acknowledgeReminder(id, userId, role);
    if (reminder) this.broadcast({ type: "reminder.updated", reminder });
    return reminder;
  }

  async createWeeklyReport(
    reportingPeriod: string,
    createdBy: string,
  ): Promise<{ report: WeeklyReport; created: boolean }> {
    const res = this.store.createWeeklyReport({ reportingPeriod, createdBy });
    if (res.created) this.broadcast({ type: "weekly.updated", report: res.report });
    return res;
  }

  async getWeeklyReport(id: string): Promise<WeeklyReport | null> {
    return this.store.getWeeklyReport(id);
  }

  async listWeeklyReports(): Promise<WeeklyReport[]> {
    return this.store.listWeeklyReports();
  }

  async setWeeklyWorkflowInstance(id: string, instanceId: string): Promise<void> {
    this.store.setWeeklyWorkflowInstance(id, instanceId);
  }

  async updateWeeklyDraft(
    id: string,
    draftContent: string,
    aiGenerated?: boolean,
  ): Promise<WeeklyReport | null> {
    const report = this.store.updateWeeklyDraft(id, draftContent, aiGenerated);
    if (report) this.broadcast({ type: "weekly.updated", report });
    return report;
  }

  async setWeeklyStatus(
    id: string,
    status: WeeklyReportStatus,
    extra: { mentorFeedback?: string | null; round?: number } = {},
  ): Promise<WeeklyReport | null> {
    const report = this.store.setWeeklyStatus(id, status, extra);
    if (report) this.broadcast({ type: "weekly.updated", report });
    return report;
  }

  // -- RPC: Stage 1 (finish) attachments -----------------------------
  // Bytes live in R2 (the Worker writes them); this DO owns only the metadata.

  async createAttachment(input: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    uploaderId: string;
    uploaderName: string;
    indexStatus: AttachmentIndexStatus;
  }): Promise<Attachment> {
    const attachment = this.store.createAttachment(input);
    this.broadcast({ type: "attachment.created", attachment });
    return attachment;
  }

  async getAttachment(id: string): Promise<Attachment | null> {
    return this.store.getAttachment(id);
  }

  async listAttachments(): Promise<Attachment[]> {
    return this.store.listAttachments();
  }

  async setAttachmentIndex(
    id: string,
    indexStatus: AttachmentIndexStatus,
    chunkCount: number,
  ): Promise<Attachment | null> {
    const attachment = this.store.setAttachmentIndex(id, indexStatus, chunkCount);
    if (attachment) this.broadcast({ type: "attachment.updated", attachment });
    return attachment;
  }

  async deleteAttachment(id: string): Promise<Attachment | null> {
    const removed = this.store.deleteAttachment(id);
    if (removed) this.broadcast({ type: "attachment.deleted", id });
    return removed;
  }

  // -- WebSocket lifecycle (Hibernation API) --------------------------

  private handleWebSocketUpgrade(url: URL): Response {
    const identity = this.readIdentity(url);

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(identity satisfies SocketAttachment);

    this.sendTo(server, { type: "workspace.snapshot", ...this.buildSnapshot(url, identity) });
    this.broadcast({ type: "presence.updated", presence: this.presenceState() }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    let msg: ClientMessage;
    try {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      this.sendTo(ws, { type: "error", code: "bad_json", message: "invalid JSON frame" });
      return;
    }

    if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") {
      this.sendTo(ws, { type: "error", code: "bad_message", message: "missing message type" });
      return;
    }

    if (msg.type === "ping") {
      this.sendTo(ws, { type: "pong", t: msg.t });
      return;
    }

    const who = this.attachmentOf(ws);
    const requestId = (msg as { requestId?: unknown }).requestId;
    if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 200) {
      this.sendTo(ws, { type: "error", code: "bad_request_id", message: "mutation requires a requestId" });
      return;
    }

    if (!canMutate(who.role, msg.type)) {
      this.sendTo(ws, {
        type: "error",
        code: "forbidden",
        requestId,
        message: `role "${who.role ?? "none"}" cannot perform ${msg.type}`,
      });
      return;
    }

    // Idempotency: a replayed requestId is acknowledged without re-applying.
    if (this.store.wasProcessed(requestId)) {
      this.sendTo(ws, { type: "ack", requestId, duplicate: true });
      return;
    }

    try {
      const events = this.dispatch(msg, who);
      this.store.markProcessed(requestId);
      for (const ev of events) this.broadcast(ev);
      this.sendTo(ws, { type: "ack", requestId });
      // Phase 4A: enqueue compact history-index events. Best-effort — the
      // authoritative record is already persisted; Vectorize is not source of
      // truth, so a failed enqueue never fails the mutation.
      await this.enqueueHistoryIndex(who.workspaceId, events);
      // Phase 4B: a new blocker starts a durable reminder/escalation workflow.
      // Also best-effort and off the ack path.
      await this.enqueueWorkflowStart(who.workspaceId, events);
    } catch (err) {
      if (err instanceof AppError) {
        this.sendTo(ws, { type: "error", code: err.code, requestId, message: err.message });
      } else {
        console.error("workspace mutation failed", err);
        this.sendTo(ws, { type: "error", code: "internal", requestId, message: "internal error" });
      }
    }
  }

  /** Map broadcast events to `history.index` queue messages (UPDATE/BLOCKER/FEEDBACK only). */
  private async enqueueHistoryIndex(
    workspaceId: string,
    events: ServerMessage[],
  ): Promise<void> {
    if (!this.env.HISTORY_QUEUE || !workspaceId) return;
    const msgs: HistoryIndexEvent[] = [];
    for (const ev of events) {
      if (ev.type === "update.created") {
        msgs.push({ workspaceId, entityType: "UPDATE", entityId: String(ev.update.id) });
      } else if (ev.type === "blocker.created" || ev.type === "blocker.resolved") {
        msgs.push({ workspaceId, entityType: "BLOCKER", entityId: ev.blocker.id });
      } else if (ev.type === "feedback.created") {
        msgs.push({ workspaceId, entityType: "FEEDBACK", entityId: ev.feedback.id });
      }
    }
    if (msgs.length === 0) return;
    try {
      await Promise.all(msgs.map((m) => this.env.HISTORY_QUEUE.send(m)));
    } catch (err) {
      console.error("history-index enqueue failed (non-fatal)", err);
    }
  }

  /** A newly created blocker triggers its reminder/escalation workflow. */
  private async enqueueWorkflowStart(
    workspaceId: string,
    events: ServerMessage[],
  ): Promise<void> {
    if (!this.env.WORKFLOW_QUEUE || !workspaceId) return;
    const starts: WorkflowEventMessage[] = events
      .filter((ev) => ev.type === "blocker.created")
      .map((ev) => ({
        kind: "blocker.workflow.start" as const,
        workspaceId,
        blockerId: (ev as { blocker: Blocker }).blocker.id,
      }));
    if (starts.length === 0) return;
    try {
      await Promise.all(starts.map((m) => this.env.WORKFLOW_QUEUE.send(m)));
    } catch (err) {
      console.error("workflow-start enqueue failed (non-fatal)", err);
    }
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code);
    } catch {
      // already closing
    }
    this.broadcast({ type: "presence.updated", presence: this.presenceState() });
  }

  override webSocketError(): void {
    this.broadcast({ type: "presence.updated", presence: this.presenceState() });
  }

  // -- mutation dispatch --------------------------------------------

  private dispatch(
    msg: Exclude<ClientMessage, { type: "ping" }>,
    who: SocketAttachment,
  ): ServerMessage[] {
    switch (msg.type) {
      case "task.create": {
        const title = requireText(msg.title, "title", MAX.title);
        const description = optionalText(msg.description, "description", MAX.description);
        const status = msg.status ? requireEnum(msg.status, TASK_STATUSES, "status") : "TODO";
        const priority = msg.priority
          ? requireEnum(msg.priority, TASK_PRIORITIES, "priority")
          : null;
        const task = this.store.createTask({
          title,
          description,
          status,
          priority,
          assigneeId: emptyToNull(msg.assigneeId),
          createdBy: who.userId,
        });
        return [
          { type: "task.created", task },
          this.activity(who, "task.created", task.id, { title: task.title }),
        ];
      }

      case "task.update": {
        if (!this.store.getTask(msg.id)) throw new AppError("not_found", "task not found");
        const patch = sanitizeTaskPatch(msg.patch);
        const task = this.store.updateTask(msg.id, patch);
        if (!task) throw new AppError("not_found", "task not found");
        const events: ServerMessage[] = [{ type: "task.updated", task }];
        if (patch.status) {
          events.push(
            this.activity(
              who,
              patch.status === "DONE" ? "task.completed" : "task.moved",
              task.id,
              { title: task.title, status: task.status },
            ),
          );
        }
        return events;
      }

      case "task.move": {
        const status = requireEnum(msg.status, TASK_STATUSES, "status");
        if (!this.store.getTask(msg.id)) throw new AppError("not_found", "task not found");
        const task = this.store.updateTask(msg.id, { status });
        if (!task) throw new AppError("not_found", "task not found");
        return [
          { type: "task.updated", task },
          this.activity(
            who,
            status === "DONE" ? "task.completed" : "task.moved",
            task.id,
            { title: task.title, status },
          ),
        ];
      }

      case "task.delete": {
        const existing = this.store.getTask(msg.id);
        if (!existing) throw new AppError("not_found", "task not found");
        this.store.deleteTask(msg.id);
        return [
          { type: "task.deleted", id: msg.id },
          this.activity(who, "task.deleted", msg.id, { title: existing.title }),
        ];
      }

      case "blocker.create": {
        const description = requireText(msg.description, "description", MAX.blocker);
        const taskId = emptyToNull(msg.taskId);
        if (taskId && !this.store.getTask(taskId)) {
          throw new AppError("task_not_found", "blocker references a task that does not exist");
        }
        const blocker = this.store.createBlocker({
          description,
          taskId,
          createdBy: who.userId,
        });
        return [
          { type: "blocker.created", blocker },
          this.activity(who, "blocker.raised", blocker.id, { description }),
        ];
      }

      case "blocker.resolve": {
        const existing = this.store.getBlocker(msg.id);
        if (!existing) throw new AppError("not_found", "blocker not found");
        if (existing.status === "RESOLVED") {
          // Already resolved: idempotent success, nothing to broadcast.
          return [];
        }
        const blocker = this.store.resolveBlocker(msg.id)!;
        return [
          { type: "blocker.resolved", blocker },
          this.activity(who, "blocker.resolved", blocker.id, null),
        ];
      }

      case "update.create": {
        const content = requireText(msg.content, "content", MAX.update);
        const updateType: UpdateType = msg.updateType
          ? requireEnum(msg.updateType, UPDATE_TYPES, "updateType")
          : "DAILY";
        const update = this.store.createUpdate({
          authorId: who.userId,
          authorName: who.displayName,
          type: updateType,
          content,
        });
        return [
          { type: "update.created", update },
          this.activity(who, "update.posted", String(update.id), { updateType }),
        ];
      }

      case "feedback.create": {
        const content = requireText(msg.content, "content", MAX.feedback);
        const taskId = emptyToNull(msg.taskId);
        if (taskId && !this.store.getTask(taskId)) {
          throw new AppError("task_not_found", "feedback references a task that does not exist");
        }
        const feedback = this.store.createFeedback({
          authorId: who.userId,
          authorName: who.displayName,
          content,
          taskId,
        });
        return [
          { type: "feedback.created", feedback },
          this.activity(who, "feedback.posted", feedback.id, null),
        ];
      }
    }
  }

  private activity(
    who: SocketAttachment,
    type: Parameters<WorkspaceStore["addActivity"]>[0]["type"],
    entityId: string | null,
    metadata: Record<string, unknown> | null,
  ): ServerMessage {
    const entry = this.store.addActivity({
      actorId: who.userId,
      actorName: who.displayName,
      type,
      entityId,
      metadata,
    });
    return { type: "activity.created", activity: entry };
  }

  // -- snapshot / presence ---------------------------------------

  private buildSnapshot(url: URL, identity: SocketAttachment): WorkspaceSnapshot {
    return {
      schemaVersion: this.store.schemaVersion() || WS_PROTOCOL_VERSION,
      workspaceId: workspaceIdFrom(url),
      you: identity,
      tasks: this.store.listTasks(),
      blockers: this.store.listBlockers(),
      updates: this.store.listUpdates(),
      feedback: this.store.listFeedback(),
      activity: this.store.listActivity(),
      presence: this.presenceState(),
      reminders: this.store.listRemindersFor(identity.userId, identity.role),
      attachments: this.store.listAttachments(),
      weeklyReports: this.store.listWeeklyReports(),
    };
  }

  /** Reads the Worker-authoritative identity, with plain-param fallbacks for direct testing. */
  private readIdentity(url: URL): SocketAttachment {
    const p = url.searchParams;
    const userId = p.get("_uid") || p.get("userId") || `anon-${crypto.randomUUID().slice(0, 8)}`;
    const displayName = p.get("_name") || p.get("displayName") || "Anonymous";
    const rawRole = p.get("_role");
    const role: Role | null =
      rawRole === "intern" || rawRole === "mentor" || rawRole === "manager" ? rawRole : null;
    return { userId, displayName, role, workspaceId: workspaceIdFrom(url) };
  }

  private liveSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private attachmentOf(ws: WebSocket): SocketAttachment {
    return (
      (ws.deserializeAttachment() as SocketAttachment | null) ?? {
        userId: "unknown",
        displayName: "Unknown",
        role: null,
        workspaceId: "",
      }
    );
  }

  private presenceState(): PresenceState {
    const seen = new Map<string, PresenceMember>();
    for (const ws of this.liveSockets()) {
      const a = this.attachmentOf(ws);
      seen.set(a.userId, { userId: a.userId, displayName: a.displayName, role: a.role });
    }
    const members = [...seen.values()];
    return { count: members.length, members };
  }

  private sendTo(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket closing
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    const data = JSON.stringify(msg);
    for (const ws of this.liveSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        // socket closing
      }
    }
  }
}

// -- validation helpers ------------------------------------------------

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("empty_field", `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new AppError("field_too_long", `${field} exceeds ${max} characters`);
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new AppError("bad_field", `${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) throw new AppError("field_too_long", `${field} exceeds ${max} characters`);
  return trimmed;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AppError("bad_enum", `${field} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function emptyToNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sanitizeTaskPatch(patch: unknown): TaskPatch {
  if (!patch || typeof patch !== "object") throw new AppError("bad_patch", "patch must be an object");
  const p = patch as Record<string, unknown>;
  const out: TaskPatch = {};
  if ("title" in p) out.title = requireText(p.title, "title", MAX.title);
  if ("description" in p) out.description = optionalText(p.description, "description", MAX.description);
  if ("status" in p) out.status = requireEnum<TaskStatus>(p.status, TASK_STATUSES, "status");
  if ("priority" in p) {
    out.priority = p.priority === null ? null : requireEnum<TaskPriority>(p.priority, TASK_PRIORITIES, "priority");
  }
  if ("assigneeId" in p) out.assigneeId = emptyToNull(p.assigneeId);
  if (Object.keys(out).length === 0) throw new AppError("empty_patch", "patch has no recognised fields");
  return out;
}

function workspaceIdFrom(url: URL): string {
  const m = url.pathname.match(/\/api\/workspace\/([^/]+)\//);
  return m ? decodeURIComponent(m[1]) : "";
}
