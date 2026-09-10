/**
 * Shared contract between the React client, the Cloudflare Worker, and the
 * Workspace Durable Object. Keep this file dependency-free and runtime-agnostic.
 *
 * Phase 2: tasks, blockers, daily updates, mentor feedback, activity.
 * The Durable Object is authoritative. Clients apply an authoritative
 * `workspace.snapshot` on every (re)connect, then follow realtime mutations.
 */

/** Bump when WS message shapes or the DO SQLite schema change incompatibly. */
export const WS_PROTOCOL_VERSION = 5;

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

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export const TASK_PRIORITIES: readonly TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  dueDate: number | null;
  assigneeId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/** Mutable fields accepted on task.update (intern only — see permissions.ts). */
export type TaskPatch = Partial<{
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  dueDate: number | null;
  assigneeId: string | null;
}>;

/**
 * Blockers move OPEN -> RESOLUTION_REQUESTED (intern asked for confirmation) or
 * straight OPEN -> RESOLVED (mentor/manager resolves directly) -> terminal.
 */
export type BlockerStatus = "OPEN" | "RESOLUTION_REQUESTED" | "RESOLVED";

export interface Blocker {
  id: string;
  taskId: string | null;
  description: string;
  status: BlockerStatus;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  resolutionRequestedAt: number | null;
  resolutionRequestedBy: string | null;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  /** True once any mentor has posted a blocker_comments row — drives escalation timing. */
  mentorResponded: boolean;
}

export interface BlockerComment {
  id: string;
  blockerId: string;
  authorId: string;
  authorName: string;
  authorRole: Role | null;
  content: string;
  createdAt: number;
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
  | "task.priority_changed"
  | "blocker.raised"
  | "blocker.commented"
  | "blocker.resolution_requested"
  | "blocker.resolved"
  | "blocker.escalated"
  | "update.posted"
  | "feedback.posted"
  | "weekly.manager_override"
  | "workspace.member_added";

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
  members: WorkspaceMember[];
  tasks: Task[];
  /** OPEN/RESOLUTION_REQUESTED blockers plus a bounded tail of recently RESOLVED ones. */
  blockers: Blocker[];
  blockerComments: BlockerComment[];
  updates: ProgressUpdate[];
  feedback: Feedback[];
  activity: ActivityEntry[];
  presence: PresenceState;
  /** Phase 4B: reminders addressed to the connecting user (by role, or directly). */
  reminders: Reminder[];
  /** Role-curated "needs attention" items derived from current DO state. */
  attentionItems: AttentionItem[];
  /** Mentions addressed to the connecting user. */
  mentions: Mention[];
  /** Stage 1 (finish): workspace file attachments (metadata only; bytes live in R2). */
  attachments: Attachment[];
  /** Phase 4B: weekly reports visible to the connecting user. */
  weeklyReports: WeeklyReport[];
}

export interface WorkspaceMember {
  userId: string;
  displayName: string;
  role: Role;
  handle: string;
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
// Role-curated attention engine + @mentions
// ---------------------------------------------------------------------------

export type AttentionReason =
  // intern
  | "REVIEW_CHANGES_REQUESTED"
  | "MENTIONED"
  | "TASK_URGENT_DUE_TODAY"
  | "TASK_OVERDUE"
  | "BLOCKER_RESOLUTION_REJECTED"
  // mentor
  | "BLOCKER_WAITING_ON_YOU"
  | "BLOCKER_NO_MENTOR_RESPONSE"
  | "REPORT_READY_FOR_REVIEW"
  | "URGENT_TASK_NEEDS_GUIDANCE"
  | "INTERN_STALE"
  // manager
  | "BLOCKER_UNRESOLVED_TOO_LONG"
  | "URGENT_TASK_STILL_BLOCKED"
  | "MENTOR_REVIEW_OVERDUE"
  | "REPORT_WAITING_TOO_LONG"
  | "ESCALATION";

export type AttentionEntityType = "TASK" | "BLOCKER" | "WEEKLY_REPORT" | "MENTION";

export interface AttentionItem {
  id: string;
  recipientUserId: string | null;
  recipientRole: Role;
  reason: AttentionReason;
  title: string;
  message: string;
  entityType: AttentionEntityType;
  entityId: string;
  createdAt: number;
  /** Client navigation hint: which tab + entity to focus. */
  navigate: { tab: "overview" | "board" | "blockers" | "weekly" | "feedback" | "activity"; entityId: string | null };
}

export type MentionSourceType = "TASK_COMMENT" | "BLOCKER_COMMENT" | "UPDATE" | "WEEKLY_REVIEW";

export interface Mention {
  id: string;
  mentionedUserId: string;
  mentionedByName: string;
  sourceType: MentionSourceType;
  sourceId: string;
  snippet: string;
  createdAt: number;
  readAt: number | null;
}

// ---------------------------------------------------------------------------
// Phase 4B: weekly progress review (workspace-local; a Workflow drives it)
// ---------------------------------------------------------------------------

export type WeeklyReportStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "CHANGES_REQUESTED"
  | "RESUBMITTED"
  | "APPROVED";

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
  /** Set only when a manager overrode the mentor review — distinct audit trail. */
  overriddenBy: string | null;
  overriddenByName: string | null;
}

export type WeeklyReviewDecision = "APPROVE" | "REQUEST_CHANGES";

// ---------------------------------------------------------------------------
// Stage 1 (finish): R2 attachments + document RAG
// ---------------------------------------------------------------------------

export type AttachmentIndexStatus =
  | "pending" // queued for text extraction + embedding
  | "indexed" // chunks in Vectorize
  | "unsupported" // stored + downloadable, but no extractable text
  | "failed" // extraction/embedding error
  | "skipped"; // offline / AI unavailable at upload time

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  uploaderId: string;
  uploaderName: string;
  createdAt: number;
  indexStatus: AttachmentIndexStatus;
  chunkCount: number;
}

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
  /** Phase 4A: historical UPDATE/BLOCKER/FEEDBACK records retrieved from Vectorize. */
  retrievedHistory: number;
  /** Stage 1 (finish): document chunks retrieved from Vectorize. */
  retrievedDocuments: number;
}

/** One record returned by semantic retrieval. Internal/debug — no vectors exposed. */
export interface RetrievedHistoryItem {
  entityType: RetrievedEntityType;
  entityId: string;
  score: number;
  createdAt: number;
  status: string | null;
  snippet: string;
  /** Present for DOCUMENT chunks. */
  filename?: string;
  chunkIndex?: number;
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

/** Everything that can appear as a Vectorize match (history + uploaded docs). */
export type RetrievedEntityType = IndexableEntityType | "DOCUMENT";

/** Compact reference event on the history-index queue. Never carries the record. */
export interface HistoryIndexEvent {
  workspaceId: string;
  entityType: IndexableEntityType;
  entityId: string;
}

/** Stage 1 (finish): index the text of an uploaded R2 document into Vectorize. */
export interface DocumentIndexEvent {
  document: true;
  workspaceId: string;
  attachmentId: string;
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
  "What needs my attention?",
  "What should I discuss with my mentor?",
  "What happened this week?",
  "What recurring blockers have we had?",
];

// ---------------------------------------------------------------------------
// WebSocket messages
// ---------------------------------------------------------------------------

/** client -> Durable Object. Every mutation carries a client-generated requestId. */
export type ClientMessage =
  | { type: "task.create"; requestId: string; title: string; description?: string | null; priority?: TaskPriority | null; dueDate?: number | null; assigneeId?: string | null; status?: TaskStatus }
  | { type: "task.update"; requestId: string; id: string; patch: TaskPatch }
  | { type: "task.move"; requestId: string; id: string; status: TaskStatus }
  | { type: "task.delete"; requestId: string; id: string }
  /** Mentor/manager narrow priority-only edit — cannot touch status/title/etc. */
  | { type: "task.priority"; requestId: string; id: string; priority: TaskPriority }
  | { type: "blocker.create"; requestId: string; description: string; taskId?: string | null }
  | { type: "blocker.comment"; requestId: string; id: string; content: string }
  | { type: "blocker.requestResolution"; requestId: string; id: string }
  | { type: "blocker.resolve"; requestId: string; id: string; note: string }
  | { type: "blocker.escalate"; requestId: string; id: string; note?: string | null }
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
  | { type: "blocker.commented"; blocker: Blocker; comment: BlockerComment }
  | { type: "blocker.resolved"; blocker: Blocker }
  | { type: "update.created"; update: ProgressUpdate }
  | { type: "feedback.created"; feedback: Feedback }
  | { type: "activity.created"; activity: ActivityEntry }
  | { type: "presence.updated"; presence: PresenceState }
  | { type: "reminder.created"; reminder: Reminder }
  | { type: "reminder.updated"; reminder: Reminder }
  | { type: "mention.created"; mention: Mention }
  | { type: "attention.updated"; items: AttentionItem[] }
  | { type: "weekly.updated"; report: WeeklyReport }
  | { type: "attachment.created"; attachment: Attachment }
  | { type: "attachment.updated"; attachment: Attachment }
  | { type: "attachment.deleted"; id: string }
  | { type: "ack"; requestId: string; duplicate?: boolean }
  | { type: "error"; message: string; code?: string; requestId?: string }
  | { type: "pong"; t: number };
