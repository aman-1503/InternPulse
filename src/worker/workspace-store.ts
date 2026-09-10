/**
 * Workspace-local persistence for one internship/project workspace, backed by
 * the Durable Object's SQLite storage. Hand-written SQL, no ORM.
 *
 * This module owns:
 *  - the DO SQLite schema + its in-DO migration (v1 -> v2)
 *  - typed CRUD for tasks / blockers / updates / feedback / activity
 *  - request de-duplication (idempotency) via `processed_requests`
 *
 * The DO class (workspace-do.ts) handles transport, validation, and broadcast.
 */

import {
  type ActivityEntry,
  type ActivityType,
  type Attachment,
  type AttachmentIndexStatus,
  type Blocker,
  type BlockerComment,
  type Feedback,
  type Mention,
  type MentionSourceType,
  type ProgressUpdate,
  type Reminder,
  type ReminderEntityType,
  type ReminderType,
  type Role,
  type Task,
  type TaskPatch,
  type TaskPriority,
  type TaskStatus,
  type UpdateType,
  type WeeklyReport,
  type WeeklyReportStatus,
  type WorkspaceSummaryStats,
  WS_PROTOCOL_VERSION,
} from "../shared/protocol";

const RESOLVED_BLOCKER_TAIL = 20;
const DEFAULT_FEED_LIMIT = 50;
const PROCESSED_TTL_MS = 60 * 60 * 1000; // keep de-dup keys for 1h

type Row = Record<string, SqlStorageValue>;

export class WorkspaceStore {
  constructor(private readonly sql: SqlStorage) {
    this.init();
  }

  // -- schema / migration ------------------------------------------------

  private init(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS workspace_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const version = Number(this.meta("schema_version") ?? "0");
    if (version < 2) this.migrateToV2();
    if (version < 3) this.migrateToV3();
    if (version < 4) this.migrateToV4();
    if (version < 5) this.migrateToV5();
    if (version < WS_PROTOCOL_VERSION) {
      this.setMeta("schema_version", String(WS_PROTOCOL_VERSION));
    }
  }

  /**
   * Product-polish pass: URGENT priority + task due dates, blocker discussion
   * threads + resolution-requested/resolved-with-note lifecycle, @mentions,
   * and the weekly RESUBMITTED status + manager-override audit fields.
   * SQLite CHECK constraints can't be altered in place, so tasks/blockers/
   * weekly_reports are rebuilt with the same rename-and-copy pattern used by
   * migrateToV2 for `updates`.
   */
  private migrateToV5(): void {
    this.sql.exec(`
      CREATE TABLE tasks__v5 (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        description  TEXT,
        status      TEXT NOT NULL DEFAULT 'TODO'
                      CHECK (status IN ('TODO','IN_PROGRESS','BLOCKED','DONE')),
        priority    TEXT CHECK (priority IN ('LOW','MEDIUM','HIGH','URGENT')),
        due_date    INTEGER,
        assignee_id TEXT,
        created_by  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      INSERT INTO tasks__v5 (id, title, description, status, priority, assignee_id, created_by, created_at, updated_at)
        SELECT id, title, description, status, priority, assignee_id, created_by, created_at, updated_at FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks__v5 RENAME TO tasks;
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);

      CREATE TABLE blockers__v5 (
        id                      TEXT PRIMARY KEY,
        task_id                 TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        description             TEXT NOT NULL,
        status                  TEXT NOT NULL DEFAULT 'OPEN'
                                  CHECK (status IN ('OPEN','RESOLUTION_REQUESTED','RESOLVED')),
        created_by              TEXT NOT NULL,
        created_by_name         TEXT NOT NULL DEFAULT '',
        created_at              INTEGER NOT NULL,
        resolution_requested_at INTEGER,
        resolution_requested_by TEXT,
        resolved_at             INTEGER,
        resolved_by             TEXT,
        resolved_by_name        TEXT,
        resolution_note         TEXT,
        mentor_responded        INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO blockers__v5 (id, task_id, description, status, created_by, created_at, resolved_at)
        SELECT id, task_id, description, status, created_by, created_at, resolved_at FROM blockers;
      DROP TABLE blockers;
      ALTER TABLE blockers__v5 RENAME TO blockers;
      CREATE INDEX IF NOT EXISTS idx_blockers_status ON blockers (status);

      CREATE TABLE IF NOT EXISTS blocker_comments (
        id          TEXT PRIMARY KEY,
        blocker_id  TEXT NOT NULL REFERENCES blockers(id) ON DELETE CASCADE,
        author_id   TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_role TEXT,
        content     TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_blocker_comments_blocker ON blocker_comments (blocker_id, created_at);

      CREATE TABLE IF NOT EXISTS mentions (
        id                 TEXT PRIMARY KEY,
        mentioned_user_id  TEXT NOT NULL,
        mentioned_by_name  TEXT NOT NULL,
        source_type        TEXT NOT NULL,
        source_id          TEXT NOT NULL,
        snippet            TEXT NOT NULL,
        created_at         INTEGER NOT NULL,
        read_at            INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mentions_dedup
        ON mentions (mentioned_user_id, source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_mentions_inbox ON mentions (mentioned_user_id, created_at);

      CREATE TABLE weekly_reports__v5 (
        id                   TEXT PRIMARY KEY,
        reporting_period     TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'DRAFT'
                               CHECK (status IN ('DRAFT','SUBMITTED','CHANGES_REQUESTED','RESUBMITTED','APPROVED')),
        draft_content        TEXT NOT NULL DEFAULT '',
        final_content        TEXT,
        mentor_feedback      TEXT,
        round                INTEGER NOT NULL DEFAULT 0,
        ai_generated         INTEGER NOT NULL DEFAULT 1,
        created_by           TEXT NOT NULL,
        workflow_instance_id TEXT,
        created_at           INTEGER NOT NULL,
        submitted_at         INTEGER,
        mentor_reviewed_at   INTEGER,
        finalized_at         INTEGER,
        overridden_by        TEXT,
        overridden_by_name   TEXT
      );
      INSERT INTO weekly_reports__v5
        (id, reporting_period, status, draft_content, final_content, mentor_feedback, round,
         ai_generated, created_by, workflow_instance_id, created_at, submitted_at, mentor_reviewed_at, finalized_at)
        SELECT id, reporting_period, status, draft_content, final_content, mentor_feedback, round,
               ai_generated, created_by, workflow_instance_id, created_at, submitted_at, mentor_reviewed_at, finalized_at
          FROM weekly_reports;
      DROP TABLE weekly_reports;
      ALTER TABLE weekly_reports__v5 RENAME TO weekly_reports;
      CREATE INDEX IF NOT EXISTS idx_weekly_status ON weekly_reports (status);
    `);
  }

  /** Stage 1 (finish): workspace file attachment metadata (bytes live in R2). */
  private migrateToV4(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS attachments (
        id            TEXT PRIMARY KEY,
        filename      TEXT NOT NULL,
        content_type  TEXT NOT NULL,
        size          INTEGER NOT NULL,
        uploader_id   TEXT NOT NULL,
        uploader_name TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        index_status  TEXT NOT NULL DEFAULT 'pending',
        chunk_count   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_created ON attachments (created_at);
    `);
  }

  /** Phase 4B: workspace-local reminders + weekly reports (additive). */
  private migrateToV3(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id                TEXT PRIMARY KEY,
        recipient_user_id TEXT,
        recipient_role    TEXT NOT NULL CHECK (recipient_role IN ('intern','mentor','manager')),
        type              TEXT NOT NULL,
        entity_type       TEXT NOT NULL,
        entity_id         TEXT NOT NULL,
        message           TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED')),
        created_at        INTEGER NOT NULL,
        acknowledged_at   INTEGER,
        snoozed_until     INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_dedup
        ON reminders (entity_type, entity_id, type, recipient_role);
      CREATE INDEX IF NOT EXISTS idx_reminders_inbox
        ON reminders (recipient_role, status);

      CREATE TABLE IF NOT EXISTS weekly_reports (
        id                   TEXT PRIMARY KEY,
        reporting_period     TEXT NOT NULL,
        status               TEXT NOT NULL DEFAULT 'DRAFT'
                               CHECK (status IN ('DRAFT','SUBMITTED','CHANGES_REQUESTED','APPROVED')),
        draft_content        TEXT NOT NULL DEFAULT '',
        final_content        TEXT,
        mentor_feedback      TEXT,
        round                INTEGER NOT NULL DEFAULT 0,
        ai_generated         INTEGER NOT NULL DEFAULT 1,
        created_by           TEXT NOT NULL,
        workflow_instance_id TEXT,
        created_at           INTEGER NOT NULL,
        submitted_at         INTEGER,
        mentor_reviewed_at   INTEGER,
        finalized_at         INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_weekly_status ON weekly_reports (status);
    `);
  }

  private migrateToV2(): void {
    // `updates` may not exist (fresh DO), may be the Phase 1 shape (has `body`,
    // no `type`/`content`), or may already be current. Normalise all three.
    const updateCols = this.sql
      .exec("PRAGMA table_info(updates)")
      .toArray()
      .map((r) => String(r.name));

    if (updateCols.length === 0) {
      this.sql.exec(`
        CREATE TABLE updates (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          author_id   TEXT NOT NULL,
          author_name TEXT NOT NULL,
          type        TEXT NOT NULL DEFAULT 'DAILY'
                        CHECK (type IN ('DAILY','WEEKLY','GENERAL')),
          content     TEXT NOT NULL,
          created_at  INTEGER NOT NULL
        );
      `);
    } else if (updateCols.includes("body") && !updateCols.includes("content")) {
      this.sql.exec(`
        CREATE TABLE updates__v2 (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          author_id   TEXT NOT NULL,
          author_name TEXT NOT NULL,
          type        TEXT NOT NULL DEFAULT 'DAILY'
                        CHECK (type IN ('DAILY','WEEKLY','GENERAL')),
          content     TEXT NOT NULL,
          created_at  INTEGER NOT NULL
        );
        INSERT INTO updates__v2 (id, author_id, author_name, type, content, created_at)
          SELECT id, author_id, author_name, 'GENERAL', body, created_at FROM updates;
        DROP TABLE updates;
        ALTER TABLE updates__v2 RENAME TO updates;
      `);
    }

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        description  TEXT,
        status      TEXT NOT NULL DEFAULT 'TODO'
                      CHECK (status IN ('TODO','IN_PROGRESS','BLOCKED','DONE')),
        priority    TEXT CHECK (priority IN ('LOW','MEDIUM','HIGH')),
        assignee_id TEXT,
        created_by  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS blockers (
        id          TEXT PRIMARY KEY,
        task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
        created_by  TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        resolved_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id          TEXT PRIMARY KEY,
        author_id   TEXT NOT NULL,
        author_name TEXT NOT NULL,
        content     TEXT NOT NULL,
        task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS activity (
        id         TEXT PRIMARY KEY,
        actor_id   TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        type       TEXT NOT NULL,
        entity_id  TEXT,
        metadata   TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_requests (
        request_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
      CREATE INDEX IF NOT EXISTS idx_blockers_status ON blockers (status);
      CREATE INDEX IF NOT EXISTS idx_activity_created ON activity (created_at);
    `);
  }

  private meta(key: string): string | null {
    const row = this.sql
      .exec("SELECT value FROM workspace_meta WHERE key = ?", key)
      .toArray()[0];
    return row ? String(row.value) : null;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec(
      "INSERT INTO workspace_meta (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  schemaVersion(): number {
    return Number(this.meta("schema_version") ?? "0");
  }

  // -- idempotency -----------------------------------------------------

  /**
   * Atomically claims a requestId — call this SYNCHRONOUSLY, before any
   * `await`, so two identical in-flight messages can't both pass the
   * not-yet-processed check while the first is still awaiting its async work
   * (e.g. mention parsing's D1 round-trip). Returns false if already claimed.
   */
  claimRequest(requestId: string): boolean {
    const claimed =
      this.sql.exec(
        "INSERT OR IGNORE INTO processed_requests (request_id, created_at) VALUES (?, ?)",
        requestId,
        Date.now(),
      ).rowsWritten > 0;
    // opportunistic prune so the table can't grow without bound
    this.sql.exec("DELETE FROM processed_requests WHERE created_at < ?", Date.now() - PROCESSED_TTL_MS);
    return claimed;
  }

  /** Releases a claimed requestId whose mutation failed, so a genuine retry can proceed. */
  releaseRequest(requestId: string): void {
    this.sql.exec("DELETE FROM processed_requests WHERE request_id = ?", requestId);
  }

  // -- tasks ---------------------------------------------------------

  listTasks(): Task[] {
    return this.sql
      .exec("SELECT * FROM tasks ORDER BY created_at ASC")
      .toArray()
      .map(toTask);
  }

  getTask(id: string): Task | null {
    const row = this.sql.exec("SELECT * FROM tasks WHERE id = ?", id).toArray()[0];
    return row ? toTask(row) : null;
  }

  createTask(input: {
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority | null;
    dueDate: number | null;
    assigneeId: string | null;
    createdBy: string;
  }): Task {
    const now = Date.now();
    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO tasks (id, title, description, status, priority, due_date, assignee_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.title,
      input.description,
      input.status,
      input.priority,
      input.dueDate,
      input.assigneeId,
      input.createdBy,
      now,
      now,
    );
    return this.getTask(id)!;
  }

  /** Mentor/manager narrow priority-only edit — never touches any other column. */
  setTaskPriority(id: string, priority: TaskPriority): Task | null {
    if (!this.getTask(id)) return null;
    this.sql.exec("UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ?", priority, Date.now(), id);
    return this.getTask(id);
  }

  updateTask(id: string, patch: TaskPatch): Task | null {
    const existing = this.getTask(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: SqlStorageValue[] = [];
    const set = <K extends keyof TaskPatch>(col: string, val: TaskPatch[K]) => {
      fields.push(`${col} = ?`);
      values.push(val as SqlStorageValue);
    };

    if (patch.title !== undefined) set("title", patch.title);
    if (patch.description !== undefined) set("description", patch.description);
    if (patch.status !== undefined) set("status", patch.status);
    if (patch.priority !== undefined) set("priority", patch.priority);
    if (patch.dueDate !== undefined) set("due_date", patch.dueDate);
    if (patch.assigneeId !== undefined) set("assignee_id", patch.assigneeId);

    if (fields.length === 0) return existing; // no-op patch, last-write-wins is fine

    fields.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);

    this.sql.exec(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`, ...values);
    return this.getTask(id);
  }

  /** Deletes a task and detaches any blockers/feedback that referenced it. */
  deleteTask(id: string): boolean {
    if (!this.getTask(id)) return false;
    this.sql.exec("UPDATE blockers SET task_id = NULL WHERE task_id = ?", id);
    this.sql.exec("UPDATE feedback SET task_id = NULL WHERE task_id = ?", id);
    this.sql.exec("DELETE FROM tasks WHERE id = ?", id);
    return true;
  }

  // -- blockers ----------------------------------------------------

  /** OPEN/RESOLUTION_REQUESTED blockers plus a bounded tail of the most recently RESOLVED ones. */
  listBlockers(): Blocker[] {
    const open = this.sql
      .exec(
        "SELECT * FROM blockers WHERE status IN ('OPEN','RESOLUTION_REQUESTED') ORDER BY created_at DESC",
      )
      .toArray()
      .map(toBlocker);
    const resolved = this.sql
      .exec(
        "SELECT * FROM blockers WHERE status = 'RESOLVED' ORDER BY resolved_at DESC LIMIT ?",
        RESOLVED_BLOCKER_TAIL,
      )
      .toArray()
      .map(toBlocker);
    return [...open, ...resolved];
  }

  getBlocker(id: string): Blocker | null {
    const row = this.sql.exec("SELECT * FROM blockers WHERE id = ?", id).toArray()[0];
    return row ? toBlocker(row) : null;
  }

  createBlocker(input: {
    description: string;
    taskId: string | null;
    createdBy: string;
    createdByName: string;
  }): Blocker {
    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO blockers (id, task_id, description, status, created_by, created_by_name, created_at, resolved_at)
       VALUES (?, ?, ?, 'OPEN', ?, ?, ?, NULL)`,
      id,
      input.taskId,
      input.description,
      input.createdBy,
      input.createdByName,
      Date.now(),
    );
    return this.getBlocker(id)!;
  }

  /** Intern asks mentor/mentor to confirm resolution. Only valid from OPEN. */
  requestBlockerResolution(id: string, requestedBy: string): Blocker | null {
    const existing = this.getBlocker(id);
    if (!existing || existing.status !== "OPEN") return null;
    this.sql.exec(
      "UPDATE blockers SET status = 'RESOLUTION_REQUESTED', resolution_requested_at = ?, resolution_requested_by = ? WHERE id = ?",
      Date.now(),
      requestedBy,
      id,
    );
    return this.getBlocker(id);
  }

  /** Resolves an OPEN or RESOLUTION_REQUESTED blocker with a required note. */
  resolveBlocker(
    id: string,
    resolvedBy: string,
    resolvedByName: string,
    note: string,
  ): Blocker | null {
    const existing = this.getBlocker(id);
    if (!existing || existing.status === "RESOLVED") return null;
    this.sql.exec(
      `UPDATE blockers
          SET status = 'RESOLVED', resolved_at = ?, resolved_by = ?, resolved_by_name = ?, resolution_note = ?
        WHERE id = ?`,
      Date.now(),
      resolvedBy,
      resolvedByName,
      note,
      id,
    );
    return this.getBlocker(id);
  }

  markMentorResponded(blockerId: string): void {
    this.sql.exec("UPDATE blockers SET mentor_responded = 1 WHERE id = ?", blockerId);
  }

  addBlockerComment(input: {
    blockerId: string;
    authorId: string;
    authorName: string;
    authorRole: Role | null;
    content: string;
  }): BlockerComment {
    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO blocker_comments (id, blocker_id, author_id, author_name, author_role, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.blockerId,
      input.authorId,
      input.authorName,
      input.authorRole,
      input.content,
      Date.now(),
    );
    if (input.authorRole === "mentor") this.markMentorResponded(input.blockerId);
    return this.sql
      .exec("SELECT * FROM blocker_comments WHERE id = ?", id)
      .toArray()
      .map(toBlockerComment)[0];
  }

  listBlockerComments(blockerId: string): BlockerComment[] {
    return this.sql
      .exec(
        "SELECT * FROM blocker_comments WHERE blocker_id = ? ORDER BY created_at ASC",
        blockerId,
      )
      .toArray()
      .map(toBlockerComment);
  }

  listAllBlockerComments(limit = 200): BlockerComment[] {
    return this.sql
      .exec("SELECT * FROM blocker_comments ORDER BY created_at DESC LIMIT ?", limit)
      .toArray()
      .map(toBlockerComment);
  }

  // -- mentions ------------------------------------------------------

  /** Idempotent per (mentionedUserId, sourceType, sourceId): a retried mutation can't double-mention. */
  createMention(input: {
    mentionedUserId: string;
    mentionedByName: string;
    sourceType: MentionSourceType;
    sourceId: string;
    snippet: string;
  }): Mention | null {
    const id = crypto.randomUUID();
    const res = this.sql.exec(
      `INSERT OR IGNORE INTO mentions
         (id, mentioned_user_id, mentioned_by_name, source_type, source_id, snippet, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.mentionedUserId,
      input.mentionedByName,
      input.sourceType,
      input.sourceId,
      input.snippet,
      Date.now(),
    );
    if (res.rowsWritten === 0) return null;
    return this.sql.exec("SELECT * FROM mentions WHERE id = ?", id).toArray().map(toMention)[0];
  }

  listMentionsFor(userId: string, limit = 50): Mention[] {
    return this.sql
      .exec(
        "SELECT * FROM mentions WHERE mentioned_user_id = ? ORDER BY created_at DESC LIMIT ?",
        userId,
        limit,
      )
      .toArray()
      .map(toMention);
  }

  // -- updates ---------------------------------------------------

  listUpdates(limit = DEFAULT_FEED_LIMIT): ProgressUpdate[] {
    return this.sql
      .exec("SELECT * FROM updates ORDER BY id DESC LIMIT ?", limit)
      .toArray()
      .map(toUpdate);
  }

  createUpdate(input: {
    authorId: string;
    authorName: string;
    type: UpdateType;
    content: string;
  }): ProgressUpdate {
    const { id } = this.sql
      .exec(
        `INSERT INTO updates (author_id, author_name, type, content, created_at)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        input.authorId,
        input.authorName,
        input.type,
        input.content,
        Date.now(),
      )
      .one() as { id: number };
    return this.sql.exec("SELECT * FROM updates WHERE id = ?", id).toArray().map(toUpdate)[0];
  }

  latestUpdate(): ProgressUpdate | null {
    const row = this.sql.exec("SELECT * FROM updates ORDER BY id DESC LIMIT 1").toArray()[0];
    return row ? toUpdate(row) : null;
  }

  getUpdate(id: number): ProgressUpdate | null {
    const row = this.sql.exec("SELECT * FROM updates WHERE id = ?", id).toArray()[0];
    return row ? toUpdate(row) : null;
  }

  // -- feedback ------------------------------------------------

  listFeedback(limit = DEFAULT_FEED_LIMIT): Feedback[] {
    return this.sql
      .exec("SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?", limit)
      .toArray()
      .map(toFeedback);
  }

  getFeedback(id: string): Feedback | null {
    const row = this.sql.exec("SELECT * FROM feedback WHERE id = ?", id).toArray()[0];
    return row ? toFeedback(row) : null;
  }

  createFeedback(input: {
    authorId: string;
    authorName: string;
    content: string;
    taskId: string | null;
  }): Feedback {
    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO feedback (id, author_id, author_name, content, task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      input.authorId,
      input.authorName,
      input.content,
      input.taskId,
      Date.now(),
    );
    return this.sql.exec("SELECT * FROM feedback WHERE id = ?", id).toArray().map(toFeedback)[0];
  }

  // -- activity ----------------------------------------------

  listActivity(limit = DEFAULT_FEED_LIMIT): ActivityEntry[] {
    return this.sql
      .exec("SELECT * FROM activity ORDER BY created_at DESC LIMIT ?", limit)
      .toArray()
      .map(toActivity);
  }

  addActivity(input: {
    actorId: string;
    actorName: string;
    type: ActivityType;
    entityId: string | null;
    metadata?: Record<string, unknown> | null;
  }): ActivityEntry {
    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO activity (id, actor_id, actor_name, type, entity_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.actorId,
      input.actorName,
      input.type,
      input.entityId,
      input.metadata ? JSON.stringify(input.metadata) : null,
      Date.now(),
    );
    return this.sql.exec("SELECT * FROM activity WHERE id = ?", id).toArray().map(toActivity)[0];
  }

  // -- aggregate -------------------------------------------

  summaryStats(): WorkspaceSummaryStats {
    const activeTasks = Number(
      this.sql.exec("SELECT COUNT(*) AS n FROM tasks WHERE status != 'DONE'").toArray()[0].n,
    );
    const openBlockers = Number(
      this.sql.exec("SELECT COUNT(*) AS n FROM blockers WHERE status = 'OPEN'").toArray()[0].n,
    );
    const latest = this.latestUpdate();
    return {
      activeTasks,
      openBlockers,
      latestUpdate: latest
        ? { authorName: latest.authorName, content: latest.content, createdAt: latest.createdAt }
        : null,
    };
  }

  // -- reminders (Phase 4B) --------------------------------------------

  /**
   * Idempotent: the (entity_type, entity_id, type, recipient_role) unique index
   * means re-running a workflow step never creates a duplicate reminder.
   * Returns the reminder if this call created it, or null if it already existed.
   */
  createReminder(input: {
    recipientUserId: string | null;
    recipientRole: Role;
    type: ReminderType;
    entityType: ReminderEntityType;
    entityId: string;
    message: string;
  }): Reminder | null {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const cur = this.sql.exec(
      `INSERT OR IGNORE INTO reminders
         (id, recipient_user_id, recipient_role, type, entity_type, entity_id, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
      id,
      input.recipientUserId,
      input.recipientRole,
      input.type,
      input.entityType,
      input.entityId,
      input.message,
      createdAt,
    );
    if (cur.rowsWritten === 0) return null;
    return this.getReminder(id);
  }

  getReminder(id: string): Reminder | null {
    const row = this.sql.exec("SELECT * FROM reminders WHERE id = ?", id).toArray()[0];
    return row ? toReminder(row) : null;
  }

  /** Reminders addressed to a user: their role's reminders + any pinned to them. */
  listRemindersFor(userId: string, role: Role | null): Reminder[] {
    if (!role) return [];
    return this.sql
      .exec(
        `SELECT * FROM reminders
          WHERE recipient_role = ?
            AND (recipient_user_id IS NULL OR recipient_user_id = ?)
          ORDER BY created_at DESC LIMIT 100`,
        role,
        userId,
      )
      .toArray()
      .map(toReminder);
  }

  acknowledgeReminder(id: string, userId: string, role: Role | null): Reminder | null {
    const r = this.getReminder(id);
    if (!r) return null;
    if (r.recipientRole !== role) return null; // not yours to ack
    if (r.recipientUserId && r.recipientUserId !== userId) return null;
    if (r.status === "ACKNOWLEDGED") return r; // idempotent
    this.sql.exec(
      "UPDATE reminders SET status = 'ACKNOWLEDGED', acknowledged_at = ? WHERE id = ?",
      Date.now(),
      id,
    );
    return this.getReminder(id);
  }

  // -- weekly reports (Phase 4B) -------------------------------------

  /** Idempotent per period: an existing non-APPROVED report for the period is returned as-is. */
  createWeeklyReport(input: {
    reportingPeriod: string;
    createdBy: string;
  }): { report: WeeklyReport; created: boolean } {
    const existing = this.sql
      .exec(
        "SELECT * FROM weekly_reports WHERE reporting_period = ? AND status != 'APPROVED' ORDER BY created_at DESC LIMIT 1",
        input.reportingPeriod,
      )
      .toArray()[0];
    if (existing) return { report: toWeekly(existing), created: false };

    const id = crypto.randomUUID();
    this.sql.exec(
      `INSERT INTO weekly_reports (id, reporting_period, status, created_by, created_at)
       VALUES (?, ?, 'DRAFT', ?, ?)`,
      id,
      input.reportingPeriod,
      input.createdBy,
      Date.now(),
    );
    return { report: this.getWeeklyReport(id)!, created: true };
  }

  getWeeklyReport(id: string): WeeklyReport | null {
    const row = this.sql.exec("SELECT * FROM weekly_reports WHERE id = ?", id).toArray()[0];
    return row ? toWeekly(row) : null;
  }

  listWeeklyReports(limit = 50): WeeklyReport[] {
    return this.sql
      .exec("SELECT * FROM weekly_reports ORDER BY created_at DESC LIMIT ?", limit)
      .toArray()
      .map(toWeekly);
  }

  setWeeklyWorkflowInstance(id: string, instanceId: string): void {
    this.sql.exec("UPDATE weekly_reports SET workflow_instance_id = ? WHERE id = ?", instanceId, id);
  }

  /** Edit the draft. Only meaningful while DRAFT or CHANGES_REQUESTED (caller enforces). */
  updateWeeklyDraft(id: string, draftContent: string, aiGenerated?: boolean): WeeklyReport | null {
    if (!this.getWeeklyReport(id)) return null;
    if (aiGenerated === undefined) {
      this.sql.exec("UPDATE weekly_reports SET draft_content = ? WHERE id = ?", draftContent, id);
    } else {
      this.sql.exec(
        "UPDATE weekly_reports SET draft_content = ?, ai_generated = ? WHERE id = ?",
        draftContent,
        aiGenerated ? 1 : 0,
        id,
      );
    }
    return this.getWeeklyReport(id);
  }

  setWeeklyStatus(
    id: string,
    status: WeeklyReportStatus,
    extra: { mentorFeedback?: string | null; round?: number } = {},
  ): WeeklyReport | null {
    const r = this.getWeeklyReport(id);
    if (!r) return null;
    const now = Date.now();
    const sets: string[] = ["status = ?"];
    const vals: SqlStorageValue[] = [status];
    if (status === "SUBMITTED" || status === "RESUBMITTED") {
      sets.push("submitted_at = ?");
      vals.push(now);
    }
    if (status === "CHANGES_REQUESTED") {
      sets.push("mentor_reviewed_at = ?");
      vals.push(now);
      sets.push("mentor_feedback = ?");
      vals.push(extra.mentorFeedback ?? null);
    }
    if (status === "APPROVED") {
      sets.push("mentor_reviewed_at = ?", "finalized_at = ?", "final_content = draft_content");
      vals.push(now, now);
    }
    if (extra.round !== undefined) {
      sets.push("round = ?");
      vals.push(extra.round);
    }
    vals.push(id);
    this.sql.exec(`UPDATE weekly_reports SET ${sets.join(", ")} WHERE id = ?`, ...vals);
    return this.getWeeklyReport(id);
  }

  /** Records a manager override alongside the normal APPROVED/CHANGES_REQUESTED transition. */
  setWeeklyOverride(id: string, overriddenBy: string, overriddenByName: string): WeeklyReport | null {
    if (!this.getWeeklyReport(id)) return null;
    this.sql.exec(
      "UPDATE weekly_reports SET overridden_by = ?, overridden_by_name = ? WHERE id = ?",
      overriddenBy,
      overriddenByName,
      id,
    );
    return this.getWeeklyReport(id);
  }

  // -- attachments (Stage 1 finish) ---------------------------------

  createAttachment(input: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    uploaderId: string;
    uploaderName: string;
    indexStatus: AttachmentIndexStatus;
  }): Attachment {
    this.sql.exec(
      `INSERT INTO attachments
         (id, filename, content_type, size, uploader_id, uploader_name, created_at, index_status, chunk_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      input.id,
      input.filename,
      input.contentType,
      input.size,
      input.uploaderId,
      input.uploaderName,
      Date.now(),
      input.indexStatus,
    );
    return this.getAttachment(input.id)!;
  }

  getAttachment(id: string): Attachment | null {
    const row = this.sql.exec("SELECT * FROM attachments WHERE id = ?", id).toArray()[0];
    return row ? toAttachment(row) : null;
  }

  listAttachments(limit = 100): Attachment[] {
    return this.sql
      .exec("SELECT * FROM attachments ORDER BY created_at DESC LIMIT ?", limit)
      .toArray()
      .map(toAttachment);
  }

  setAttachmentIndex(
    id: string,
    indexStatus: AttachmentIndexStatus,
    chunkCount: number,
  ): Attachment | null {
    if (!this.getAttachment(id)) return null;
    this.sql.exec(
      "UPDATE attachments SET index_status = ?, chunk_count = ? WHERE id = ?",
      indexStatus,
      chunkCount,
      id,
    );
    return this.getAttachment(id);
  }

  deleteAttachment(id: string): Attachment | null {
    const existing = this.getAttachment(id);
    if (!existing) return null;
    this.sql.exec("DELETE FROM attachments WHERE id = ?", id);
    return existing;
  }
}

// -- row -> domain mappers ---------------------------------------------

function toTask(r: Row): Task {
  return {
    id: String(r.id),
    title: String(r.title),
    description: r.description === null ? null : String(r.description),
    status: String(r.status) as TaskStatus,
    priority: r.priority === null ? null : (String(r.priority) as TaskPriority),
    dueDate: r.due_date === null || r.due_date === undefined ? null : Number(r.due_date),
    assigneeId: r.assignee_id === null ? null : String(r.assignee_id),
    createdBy: String(r.created_by),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function toBlocker(r: Row): Blocker {
  return {
    id: String(r.id),
    taskId: r.task_id === null ? null : String(r.task_id),
    description: String(r.description),
    status: String(r.status) as Blocker["status"],
    createdBy: String(r.created_by),
    createdByName: r.created_by_name === null || r.created_by_name === undefined ? "" : String(r.created_by_name),
    createdAt: Number(r.created_at),
    resolutionRequestedAt: r.resolution_requested_at === null || r.resolution_requested_at === undefined ? null : Number(r.resolution_requested_at),
    resolutionRequestedBy: r.resolution_requested_by === null || r.resolution_requested_by === undefined ? null : String(r.resolution_requested_by),
    resolvedAt: r.resolved_at === null ? null : Number(r.resolved_at),
    resolvedBy: r.resolved_by === null || r.resolved_by === undefined ? null : String(r.resolved_by),
    resolvedByName: r.resolved_by_name === null || r.resolved_by_name === undefined ? null : String(r.resolved_by_name),
    resolutionNote: r.resolution_note === null || r.resolution_note === undefined ? null : String(r.resolution_note),
    mentorResponded: Number(r.mentor_responded ?? 0) === 1,
  };
}

function toBlockerComment(r: Row): BlockerComment {
  return {
    id: String(r.id),
    blockerId: String(r.blocker_id),
    authorId: String(r.author_id),
    authorName: String(r.author_name),
    authorRole: r.author_role === null ? null : (String(r.author_role) as Role),
    content: String(r.content),
    createdAt: Number(r.created_at),
  };
}

function toMention(r: Row): Mention {
  return {
    id: String(r.id),
    mentionedUserId: String(r.mentioned_user_id),
    mentionedByName: String(r.mentioned_by_name),
    sourceType: String(r.source_type) as MentionSourceType,
    sourceId: String(r.source_id),
    snippet: String(r.snippet),
    createdAt: Number(r.created_at),
    readAt: r.read_at === null ? null : Number(r.read_at),
  };
}

function toUpdate(r: Row): ProgressUpdate {
  return {
    id: Number(r.id),
    authorId: String(r.author_id),
    authorName: String(r.author_name),
    type: String(r.type) as UpdateType,
    content: String(r.content),
    createdAt: Number(r.created_at),
  };
}

function toFeedback(r: Row): Feedback {
  return {
    id: String(r.id),
    authorId: String(r.author_id),
    authorName: String(r.author_name),
    content: String(r.content),
    taskId: r.task_id === null ? null : String(r.task_id),
    createdAt: Number(r.created_at),
  };
}

function toActivity(r: Row): ActivityEntry {
  return {
    id: String(r.id),
    actorId: String(r.actor_id),
    actorName: String(r.actor_name),
    type: String(r.type) as ActivityType,
    entityId: r.entity_id === null ? null : String(r.entity_id),
    metadata: r.metadata === null ? null : (JSON.parse(String(r.metadata)) as Record<string, unknown>),
    createdAt: Number(r.created_at),
  };
}

function toReminder(r: Row): Reminder {
  return {
    id: String(r.id),
    recipientUserId: r.recipient_user_id === null ? null : String(r.recipient_user_id),
    recipientRole: String(r.recipient_role) as Role,
    type: String(r.type) as ReminderType,
    entityType: String(r.entity_type) as ReminderEntityType,
    entityId: String(r.entity_id),
    message: String(r.message),
    status: String(r.status) as Reminder["status"],
    createdAt: Number(r.created_at),
    acknowledgedAt: r.acknowledged_at === null ? null : Number(r.acknowledged_at),
    snoozedUntil: r.snoozed_until === null ? null : Number(r.snoozed_until),
  };
}

function toWeekly(r: Row): WeeklyReport {
  return {
    id: String(r.id),
    reportingPeriod: String(r.reporting_period),
    status: String(r.status) as WeeklyReportStatus,
    draftContent: String(r.draft_content ?? ""),
    finalContent: r.final_content === null ? null : String(r.final_content),
    mentorFeedback: r.mentor_feedback === null ? null : String(r.mentor_feedback),
    round: Number(r.round ?? 0),
    aiGenerated: Number(r.ai_generated ?? 1) === 1,
    createdBy: String(r.created_by),
    createdAt: Number(r.created_at),
    submittedAt: r.submitted_at === null ? null : Number(r.submitted_at),
    mentorReviewedAt: r.mentor_reviewed_at === null ? null : Number(r.mentor_reviewed_at),
    finalizedAt: r.finalized_at === null ? null : Number(r.finalized_at),
    overriddenBy: r.overridden_by === null || r.overridden_by === undefined ? null : String(r.overridden_by),
    overriddenByName: r.overridden_by_name === null || r.overridden_by_name === undefined ? null : String(r.overridden_by_name),
  };
}

function toAttachment(r: Row): Attachment {
  return {
    id: String(r.id),
    filename: String(r.filename),
    contentType: String(r.content_type),
    size: Number(r.size),
    uploaderId: String(r.uploader_id),
    uploaderName: String(r.uploader_name),
    createdAt: Number(r.created_at),
    indexStatus: String(r.index_status) as AttachmentIndexStatus,
    chunkCount: Number(r.chunk_count ?? 0),
  };
}
