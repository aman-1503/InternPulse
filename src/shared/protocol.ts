/**
 * Shared contract between the React client, the Cloudflare Worker, and the
 * Workspace Durable Object. Keep this file dependency-free and runtime-agnostic.
 *
 * Phase 2: tasks, blockers, daily updates, mentor feedback, activity.
 * The Durable Object is authoritative. Clients apply an authoritative
 * `workspace.snapshot` on every (re)connect, then follow realtime mutations.
 */

/** Bump when WS message shapes or the DO SQLite schema change incompatibly. */
export const WS_PROTOCOL_VERSION = 3;

export type Role = "intern" | "mentor" | "manager";

/**
 * DEV/DEMO identity. The browser supplies userId/displayName. This is NOT
 * authentication — see the Worker's authorization boundary. Later phases replace
 * it with a real authenticated principal without changing the DO.
 */
export interface Identity {
  userId: string;
  displayName: string;
}

// ---------------------------------------------------------------------------
// HTTP DTOs (bootstrap / resource operations)
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
}

export interface HealthResponse {
  ok: boolean;
  service: "internpulse";
  time: number;
  d1: "ok" | "unavailable";
}

/** One row of the manager overview. Counts/latestUpdate come from the workspace DO. */
export interface OverviewRow {
  id: string;
  name: string;
  slug: string;
  intern: { userId: string; displayName: string } | null;
  activeTasks: number;
  openBlockers: number;
  latestUpdate: { authorName: string; content: string; createdAt: number } | null;
}

export interface OverviewResponse {
  workspaces: OverviewRow[];
  /** True when the caller's identity has no manager membership and we fell back to listing all workspaces. */
  demoFallback: boolean;
}

/** Compact per-workspace aggregate the DO exposes at GET /summary. */
export interface WorkspaceSummaryStats {
  activeTasks: number;
  openBlockers: number;
  latestUpdate: { authorName: string; content: string; createdAt: number } | null;
}

// ---------------------------------------------------------------------------
// Workspace domain entities (persisted in the DO's SQLite storage)
// ---------------------------------------------------------------------------

export type TaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE";
export const TASK_STATUSES: readonly TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
];

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";
export const TASK_PRIORITIES: readonly TaskPriority[] = ["LOW", "MEDIUM", "HIGH"];

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  assigneeId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** Mutable fields accepted on task.update. */
export type TaskPatch = Partial<{
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  assigneeId: string | null;
}>;

export type BlockerStatus = "OPEN" | "RESOLVED";

export interface Blocker {
  id: string;
  taskId: string | null;
  description: string;
  status: BlockerStatus;
  createdBy: string;
  createdAt: number;
  resolvedAt: number | null;
}

export type UpdateType = "DAILY" | "WEEKLY" | "GENERAL";
export const UPDATE_TYPES: readonly UpdateType[] = ["DAILY", "WEEKLY", "GENERAL"];

export interface ProgressUpdate {
  id: number;
  authorId: string;
  authorName: string;
  type: UpdateType;
  content: string;
  createdAt: number;
}

export interface Feedback {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  taskId: string | null;
  createdAt: number;
}

export type ActivityType =
  | "task.created"
  | "task.moved"
  | "task.completed"
  | "task.deleted"
  | "blocker.raised"
  | "blocker.resolved"
  | "update.posted"
  | "feedback.posted";

export interface ActivityEntry {
  id: string;
  actorId: string;
  actorName: string;
  type: ActivityType;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Realtime presence (ephemeral — never persisted)
// ---------------------------------------------------------------------------

export interface PresenceMember {
  userId: string;
  displayName: string;
  role: Role | null;
}

export interface PresenceState {
  count: number;
  members: PresenceMember[];
}

// ---------------------------------------------------------------------------
// Authoritative snapshot
// ---------------------------------------------------------------------------

export interface WorkspaceSnapshot {
  schemaVersion: number;
  workspaceId: string;
  you: { userId: string; displayName: string; role: Role | null };
  tasks: Task[];
  /** OPEN blockers plus a bounded tail of recently RESOLVED ones. */
  blockers: Blocker[];
  updates: ProgressUpdate[];
  feedback: Feedback[];
  activity: ActivityEntry[];
  presence: PresenceState;
  /** Phase 4B: reminders addressed to the connecting user (by role, or directly). */
  reminders: Reminder[];
  /** Phase 4B: weekly reports visible to the connecting user. */
  weeklyReports: WeeklyReport[];
}

// ---------------------------------------------------------------------------
// Phase 4B: reminders / escalation (workspace-local; Workflows drive lifecycle)
// ---------------------------------------------------------------------------

export type ReminderStatus = "OPEN" | "ACKNOWLEDGED";

export type ReminderType =
  | "BLOCKER_REMINDER"
  | "BLOCKER_ESCALATION"
  | "REPORT_SUBMITTED"
  | "REPORT_CHANGES_REQUESTED"
  | "REPORT_APPROVED";

export type ReminderEntityType = "BLOCKER" | "WEEKLY_REPORT";

export interface Reminder {
  id: string;
  recipientUserId: string | null;
  recipientRole: Role;
  type: ReminderType;
  entityType: ReminderEntityType;
  entityId: string;
  message: string;
  status: ReminderStatus;
  createdAt: number;
  acknowledgedAt: number | null;
  snoozedUntil: number | null;
}

// ---------------------------------------------------------------------------
// Phase 4B: weekly progress review (workspace-local; a Workflow drives it)
// ---------------------------------------------------------------------------

export type WeeklyReportStatus = "DRAFT" | "SUBMITTED" | "CHANGES_REQUESTED" | "APPROVED";

export interface WeeklyReport {
  id: string;
  reportingPeriod: string;
  status: WeeklyReportStatus;
  draftContent: string;
  finalContent: string | null;
  mentorFeedback: string | null;
  round: number;
  aiGenerated: boolean;
  createdBy: string;
  createdAt: number;
  submittedAt: number | null;
  mentorReviewedAt: number | null;
  finalizedAt: number | null;
}

export type WeeklyReviewDecision = "APPROVE" | "REQUEST_CHANGES";

/** Message shapes carried on the internpulse-workflow-events queue. */
export type WorkflowEventMessage = {
  kind: "blocker.workflow.start";
  workspaceId: string;
  blockerId: string;
};

// ---------------------------------------------------------------------------
// Progress Agent (Phase 3)
// ---------------------------------------------------------------------------

/**
 * Bounded, read-only projection of authoritative WorkspaceDO state, assembled
 * on demand for the Progress Agent. This is NOT persisted by the agent and is
 * NOT a second source of truth — it is rebuilt from WorkspaceDO SQLite on every
 * question so the agent always reasons over current state.
 */
export interface AgentContext {
  workspaceId: string;
  generatedAt: number;
  requester: { displayName: string; role: Role | null };
  tasks: Array<{
    title: string;
    status: TaskStatus;
    priority: TaskPriority | null;
    assigneeId: string | null;
    ageDays: number;
  }>;
  doneTaskCount: number;
  truncatedTasks: number;
  openBlockers: Array<{ description: string; taskTitle: string | null; ageDays: number }>;
  resolvedBlockerCount: number;
  recentUpdates: Array<{ authorName: string; type: UpdateType; content: string; ageDays: number }>;
  recentFeedback: Array<{ authorName: string; content: string; ageDays: number }>;
  recentActivity: string[];
}

export interface AgentAskRequest {
  prompt: string;
}

export interface AgentGroundedOn {
  activeTasks: number;
  doneTasks: number;
  openBlockers: number;
  updates: number;
  feedback: number;
  activity: number;
  contextGeneratedAt: number;
  /** Phase 4A: number of historical records retrieved from Vectorize for this answer. */
  retrievedHistory: number;
}

/** One record returned by semantic retrieval. Internal/debug — no vectors exposed. */
export interface RetrievedHistoryItem {
  entityType: IndexableEntityType;
  entityId: string;
  score: number;
  createdAt: number;
  status: string | null;
  snippet: string;
}

export interface AgentAskResponse {
  answer: string;
  model: string;
  usedFakeAI: boolean;
  role: Role | null;
  groundedOn: AgentGroundedOn;
  /** What semantic retrieval surfaced (metadata only; never vector values). */
  retrieved: RetrievedHistoryItem[];
  conversationId: string;
}

// ---------------------------------------------------------------------------
// Phase 4A: history indexing (Vectorize is retrieval only, never source of truth)
// ---------------------------------------------------------------------------

export type IndexableEntityType = "UPDATE" | "BLOCKER" | "FEEDBACK";
export const INDEXABLE_ENTITY_TYPES: readonly IndexableEntityType[] = [
  "UPDATE",
  "BLOCKER",
  "FEEDBACK",
];

/** Compact reference event on the history-index queue. Never carries the record. */
export interface HistoryIndexEvent {
  workspaceId: string;
  entityType: IndexableEntityType;
  entityId: string;
}

/**
 * What WorkspaceDO returns for a history-index request: the current authoritative
 * text to embed plus minimal metadata. `null` when the entity no longer exists
 * or is not indexable — the consumer then removes any stale vector.
 */
export interface IndexableEntity {
  workspaceId: string;
  entityType: IndexableEntityType;
  entityId: string;
  text: string;
  authorId: string | null;
  createdAt: number;
  status: string | null;
}

export interface AgentTurn {
  id: string;
  userId: string;
  role: Role | null;
  prompt: string;
  answer: string;
  createdAt: number;
}

export interface AgentErrorResponse {
  error: string;
  code:
    | "empty_prompt"
    | "prompt_too_long"
    | "unauthorized"
    | "workspace_missing"
    | "ai_unavailable"
    | "agent_error";
}

export const AGENT_PROMPT_MAX = 2000;

export const AGENT_QUICK_PROMPTS: readonly string[] = [
  "Summarize current progress",
  "What am I blocked on?",
  "What should I discuss with my mentor?",
  "What changed recently?",
];

// ---------------------------------------------------------------------------
// WebSocket messages
// ---------------------------------------------------------------------------

/** client -> Durable Object. Every mutation carries a client-generated requestId. */
export type ClientMessage =
  | { type: "task.create"; requestId: string; title: string; description?: string | null; priority?: TaskPriority | null; assigneeId?: string | null; status?: TaskStatus }
  | { type: "task.update"; requestId: string; id: string; patch: TaskPatch }
  | { type: "task.move"; requestId: string; id: string; status: TaskStatus }
  | { type: "task.delete"; requestId: string; id: string }
  | { type: "blocker.create"; requestId: string; description: string; taskId?: string | null }
  | { type: "blocker.resolve"; requestId: string; id: string }
  | { type: "update.create"; requestId: string; content: string; updateType?: UpdateType }
  | { type: "feedback.create"; requestId: string; content: string; taskId?: string | null }
  | { type: "ping"; t: number };

export type MutationType = Exclude<ClientMessage["type"], "ping">;

/** Durable Object -> client. */
export type ServerMessage =
  | ({ type: "workspace.snapshot" } & WorkspaceSnapshot)
  | { type: "task.created"; task: Task }
  | { type: "task.updated"; task: Task }
  | { type: "task.deleted"; id: string }
  | { type: "blocker.created"; blocker: Blocker }
  | { type: "blocker.resolved"; blocker: Blocker }
  | { type: "update.created"; update: ProgressUpdate }
  | { type: "feedback.created"; feedback: Feedback }
  | { type: "activity.created"; activity: ActivityEntry }
  | { type: "presence.updated"; presence: PresenceState }
  | { type: "reminder.created"; reminder: Reminder }
  | { type: "reminder.updated"; reminder: Reminder }
  | { type: "weekly.updated"; report: WeeklyReport }
  | { type: "ack"; requestId: string; duplicate?: boolean }
  | { type: "error"; message: string; code?: string; requestId?: string }
  | { type: "pong"; t: number };
