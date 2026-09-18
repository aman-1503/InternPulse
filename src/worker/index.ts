import { getAgentByName } from "agents";
import { WorkspaceDO } from "./workspace-do";
import { ProgressAgent } from "./progress-agent";
import { BlockerWorkflow } from "./blocker-workflow";
import { WeeklyReviewWorkflow } from "./weekly-workflow";
import { handleHistoryIndexBatch, handleWorkflowEventBatch } from "./queue-consumer";
import { isoWeek } from "./reminders";
import {
  MAX_ATTACHMENT_BYTES,
  attachmentKey,
  attachmentsBucket,
  isExtractable,
  safeFilename,
} from "./documents";
import { AccessAuthError, getAuthenticatedIdentity } from "./access-auth";
import {
  IdentityConflictError,
  resolveProductionUser,
  updateDisplayName,
  type ProductionUser,
} from "./production-identity";
import {
  acceptInvitation,
  createInvitation,
  listPendingInvitationsForEmailEnriched,
  listWorkspaceInvitations,
  revokeInvitation,
} from "./invitations";
import { handleAdminRoute } from "./admin-routes";
import { recordAudit } from "./audit";
import type {
  DocumentIndexEvent,
  HealthResponse,
  HistoryIndexEvent,
  OverviewResponse,
  OverviewRow,
  Role,
  WeeklyReviewDecision,
  WorkflowEventMessage,
  WorkspaceSummaryStats,
} from "../shared/protocol";

// Durable Object / Agent / Workflow classes must be re-exported from the Worker's main module.
export { WorkspaceDO, ProgressAgent, BlockerWorkflow, WeeklyReviewWorkflow };

type WorkspaceStub = DurableObjectStub<WorkspaceDO>;

/** Accept only simple, safe workspace identifiers. */
const WORKSPACE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const DEV_ROLES: readonly Role[] = ["intern", "mentor", "manager"];

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

// -----------------------------------------------------------------------------
// Identity resolution. Every request is either:
//   - a PRODUCTION request (any path NOT under /api/demo/): identity MUST come
//     from a cryptographically verified Cloudflare Access assertion. The
//     browser never gets to assert userId/displayName/role here.
//   - a DEMO request (/api/demo/*): identity is the pre-existing unauthenticated
//     query-param mechanism, but every workspace touched this way must have
//     is_demo = 1 in D1, so demo traffic can never reach real workspace data
//     even if a client sends a real workspace id.
//
// In both cases the actual authorization decision — "what role, if any, does
// this user have in this workspace" — still comes from exactly one place:
// resolveRole() reading D1 `memberships`, scoped to the matching is_demo value.
// -----------------------------------------------------------------------------

interface Caller {
  userId: string;
  displayName: string;
  role: Role;
}

/** Resolves + validates the production user for this request, or a Response to return as-is. */
async function requireProductionUser(request: Request, env: Env): Promise<ProductionUser | Response> {
  let identity;
  try {
    identity = await getAuthenticatedIdentity(request, env);
  } catch (err) {
    const message = err instanceof AccessAuthError ? err.message : "authentication required";
    return json({ error: message, code: "unauthenticated" }, 401);
  }
  let user: ProductionUser;
  try {
    user = await resolveProductionUser(env, identity);
  } catch (err) {
    if (err instanceof IdentityConflictError) {
      return json({ error: err.message, code: "identity_conflict" }, 409);
    }
    throw err;
  }
  if (user.accountStatus !== "ACTIVE") {
    return json(
      { error: "this account is not active", code: `account_${user.accountStatus.toLowerCase()}` },
      403,
    );
  }
  return user;
}

/**
 * Resolves the caller's (userId, displayName) for either mode. Does NOT
 * resolve a workspace role — that always happens afterward via resolveRole,
 * scoped to the workspace's is_demo value.
 */
async function resolveCaller(
  request: Request,
  env: Env,
  url: URL,
  demoMode: boolean,
): Promise<{ userId: string; displayName: string } | Response> {
  if (demoMode) {
    if ((env.DEMO_MODE as string) === "off") {
      return json({ error: "demo mode is disabled", code: "demo_disabled" }, 404);
    }
    const userId = url.searchParams.get("userId") || `anon-${crypto.randomUUID().slice(0, 8)}`;
    const displayName = url.searchParams.get("displayName") || "Anonymous";
    return { userId, displayName };
  }
  const userOrResponse = await requireProductionUser(request, env);
  if (userOrResponse instanceof Response) return userOrResponse;
  return { userId: userOrResponse.id, displayName: userOrResponse.displayName };
}

/**
 * THE authorization boundary. Every workspace route (HTTP + WebSocket upgrade)
 * calls this exactly once; nothing downstream re-derives identity.
 *
 * D1 `memberships` is the ONLY source of authorization: a role is returned iff
 * this exact (workspaceId, userId) has a membership row AND the workspace's
 * is_demo flag matches the route the caller used to get here. There is no
 * fallback for an unmapped identity or a scope mismatch — `null` here means
 * "no access" and every caller MUST deny access entirely (no anonymous or
 * read-only browsing of a workspace you don't belong to).
 */
async function resolveRole(
  env: Env,
  workspaceId: string,
  userId: string,
  demoMode: boolean,
): Promise<Role | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT m.role AS role
         FROM memberships m
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.workspace_id = ? AND m.user_id = ? AND w.is_demo = ?
        LIMIT 1`,
    )
      .bind(workspaceId, userId, demoMode ? 1 : 0)
      .first<{ role: Role }>();
    return row?.role ?? null;
  } catch {
    // D1 unreachable/not migrated — fail closed, never fall back to anonymous access.
    return null;
  }
}

async function workspaceIsDemo(env: Env, workspaceId: string): Promise<boolean | null> {
  try {
    const row = await env.DB.prepare("SELECT is_demo AS isDemo FROM workspaces WHERE id = ?")
      .bind(workspaceId)
      .first<{ isDemo: number }>();
    return row ? row.isDemo === 1 : null;
  } catch {
    return null;
  }
}

async function handleOverview(env: Env, callerId: string): Promise<Response> {
  let baseRows: Array<{ id: string; name: string; slug: string }>;
  let demoFallback = false;
  try {
    const managed = await env.DB.prepare(
      `SELECT w.id, w.name, w.slug
         FROM workspaces w
         JOIN memberships m ON m.workspace_id = w.id
        WHERE m.user_id = ? AND m.role = 'manager' AND w.is_demo = 0
        ORDER BY w.created_at DESC`,
    )
      .bind(callerId)
      .all<{ id: string; name: string; slug: string }>();
    baseRows = managed.results;
  } catch {
    return json({
      workspaces: [],
      demoFallback: true,
      note: "D1 not migrated — run `npm run db:migrate:local` and `npm run db:seed:local`",
    });
  }

  // Fan out to each workspace DO for its own local aggregate. D1 never stores
  // workspace-local task/blocker/update state, so this read-time join is how the
  // manager view is assembled. O(workspaces) subrequests — fine at this scale.
  const workspaces: OverviewRow[] = await Promise.all(
    baseRows.map(async (w): Promise<OverviewRow> => {
      const internRow = await env.DB.prepare(
        `SELECT u.id AS userId, u.display_name AS displayName
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = ? AND m.role = 'intern'
          ORDER BY m.created_at ASC
          LIMIT 1`,
      )
        .bind(w.id)
        .first<{ userId: string; displayName: string }>();

      let stats: WorkspaceSummaryStats = { activeTasks: 0, openBlockers: 0, latestUpdate: null };
      try {
        const stub = env.WORKSPACE_DO.get(env.WORKSPACE_DO.idFromName(w.id));
        const res = await stub.fetch(`https://do.internal/api/workspace/${w.id}/summary`);
        if (res.ok) stats = (await res.json()) as WorkspaceSummaryStats;
      } catch {
        // leave zeros if the workspace DO is unreachable
      }

      return {
        id: w.id,
        name: w.name,
        slug: w.slug,
        intern: internRow ? { userId: internRow.userId, displayName: internRow.displayName } : null,
        activeTasks: stats.activeTasks,
        openBlockers: stats.openBlockers,
        latestUpdate: stats.latestUpdate,
      };
    }),
  );

  return json({ workspaces, demoFallback } satisfies OverviewResponse);
}

/** Demo-mode overview keeps the old "fall back to all workspaces" convenience, scoped to is_demo = 1. */
async function handleDemoOverview(env: Env, callerId: string): Promise<Response> {
  let baseRows: Array<{ id: string; name: string; slug: string }>;
  let demoFallback = false;
  try {
    const managed = await env.DB.prepare(
      `SELECT w.id, w.name, w.slug
         FROM workspaces w
         JOIN memberships m ON m.workspace_id = w.id
        WHERE m.user_id = ? AND m.role = 'manager' AND w.is_demo = 1
        ORDER BY w.created_at DESC`,
    )
      .bind(callerId)
      .all<{ id: string; name: string; slug: string }>();
    if (managed.results.length > 0) {
      baseRows = managed.results;
    } else {
      demoFallback = true;
      const all = await env.DB.prepare(
        "SELECT id, name, slug FROM workspaces WHERE is_demo = 1 ORDER BY created_at DESC",
      ).all<{ id: string; name: string; slug: string }>();
      baseRows = all.results;
    }
  } catch {
    return json({ workspaces: [], demoFallback: true, note: "D1 not migrated" });
  }

  const workspaces: OverviewRow[] = await Promise.all(
    baseRows.map(async (w): Promise<OverviewRow> => {
      const internRow = await env.DB.prepare(
        `SELECT u.id AS userId, u.display_name AS displayName
           FROM memberships m
           JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = ? AND m.role = 'intern'
          ORDER BY m.created_at ASC
          LIMIT 1`,
      )
        .bind(w.id)
        .first<{ userId: string; displayName: string }>();

      let stats: WorkspaceSummaryStats = { activeTasks: 0, openBlockers: 0, latestUpdate: null };
      try {
        const stub = env.WORKSPACE_DO.get(env.WORKSPACE_DO.idFromName(w.id));
        const res = await stub.fetch(`https://do.internal/api/workspace/${w.id}/summary`);
        if (res.ok) stats = (await res.json()) as WorkspaceSummaryStats;
      } catch {
        // leave zeros
      }

      return {
        id: w.id,
        name: w.name,
        slug: w.slug,
        intern: internRow ? { userId: internRow.userId, displayName: internRow.displayName } : null,
        activeTasks: stats.activeTasks,
        openBlockers: stats.openBlockers,
        latestUpdate: stats.latestUpdate,
      };
    }),
  );

  return json({ workspaces, demoFallback } satisfies OverviewResponse);
}

/**
 * Progress Agent endpoint. Goes through the SAME authorization boundary as
 * every other workspace route: a caller with no resolvable role is rejected.
 *   GET  -> this user's conversation history with the workspace agent
 *   POST -> ask the agent a question ({ prompt }); response is grounded in
 *           current authoritative WorkspaceDO state.
 */
async function handleAgent(
  env: Env,
  request: Request,
  workspaceId: string,
  caller: Caller,
): Promise<Response> {
  // wrangler's generated Env types the Agent namespace as untyped; re-attach the
  // concrete class so `agent.ask` / `agent.history` are visible.
  const agentNs = env.PROGRESS_AGENT as unknown as DurableObjectNamespace<ProgressAgent>;
  const agent = await getAgentByName<Env, ProgressAgent>(agentNs, workspaceId);

  if (request.method === "GET") {
    return json({ turns: await agent.history(caller.userId) });
  }

  if (request.method === "POST") {
    let prompt: unknown;
    try {
      ({ prompt } = (await request.json()) as { prompt?: unknown });
    } catch {
      prompt = undefined;
    }
    if (typeof prompt !== "string") {
      return json({ error: "prompt (string) is required", code: "empty_prompt" }, 400);
    }
    const result = await agent.ask({
      workspaceId,
      userId: caller.userId,
      displayName: caller.displayName,
      role: caller.role,
      prompt,
    });
    return json(result, "error" in result ? 422 : 200);
  }

  return json({ error: "method not allowed" }, 405);
}

// --- Phase 4B: reminders + weekly review (same authorization boundary) --------

async function authWorkspace(
  env: Env,
  request: Request,
  url: URL,
  workspaceId: string,
  demoMode: boolean,
): Promise<Caller | Response> {
  const callerOrResponse = await resolveCaller(request, env, url, demoMode);
  if (callerOrResponse instanceof Response) return callerOrResponse;
  const role = await resolveRole(env, workspaceId, callerOrResponse.userId, demoMode);
  if (role === null) {
    return json({ error: "you are not a member of this workspace", code: "unauthorized" }, 403);
  }
  return { ...callerOrResponse, role };
}

async function handleReminders(
  stub: WorkspaceStub,
  request: Request,
  caller: Caller,
  tail: string[],
): Promise<Response> {
  if (request.method === "GET" && tail.length === 0) {
    return json({ reminders: await stub.listReminders(caller.userId, caller.role) });
  }
  if (request.method === "POST" && tail.length === 2 && tail[1] === "ack") {
    const reminder = await stub.acknowledgeReminder(tail[0], caller.userId, caller.role);
    if (!reminder) return json({ error: "reminder not found or not addressed to you", code: "not_found" }, 404);
    return json({ reminder });
  }
  return json({ error: "not found" }, 404);
}

// --- Invitations (mentor/manager of THIS workspace, normal authWorkspace boundary) --

async function handleWorkspaceInvitations(
  env: Env,
  request: Request,
  workspaceId: string,
  caller: Caller,
  tail: string[],
): Promise<Response> {
  if (caller.role !== "mentor" && caller.role !== "manager") {
    return json({ error: "only a mentor or manager can manage invitations", code: "forbidden" }, 403);
  }

  if (request.method === "GET" && tail.length === 0) {
    return json({ invitations: await listWorkspaceInvitations(env, workspaceId) });
  }

  if (request.method === "POST" && tail.length === 0) {
    const body = (await request.json().catch(() => ({}))) as { email?: unknown; role?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const role = body.role;
    if (!email.includes("@")) return json({ error: "a valid email is required", code: "bad_request" }, 400);
    if (role !== "intern" && role !== "mentor" && role !== "manager") {
      return json({ error: "role must be intern, mentor, or manager", code: "bad_request" }, 400);
    }
    const invitation = await createInvitation(env, {
      workspaceId,
      email,
      role,
      invitedByUserId: caller.userId,
    });
    return json({ invitation }, 201);
  }

  if (request.method === "POST" && tail.length === 2 && tail[1] === "revoke") {
    const revoked = await revokeInvitation(env, {
      invitationId: tail[0],
      workspaceId,
      actorUserId: caller.userId,
    });
    if (!revoked) return json({ error: "invitation not found or not pending", code: "not_found" }, 404);
    return json({ invitation: revoked });
  }

  return json({ error: "not found" }, 404);
}

// --- Stage 1 (finish): R2 attachments -----------------------------------------

async function handleAttachments(
  env: Env,
  url: URL,
  request: Request,
  workspaceId: string,
  stub: WorkspaceStub,
  caller: Caller,
  tail: string[],
): Promise<Response> {
  // R2 is optional: if the bucket isn't configured (e.g. R2 not yet enabled on
  // the account) the rest of InternPulse still works — attachments are just off.
  const bucket = attachmentsBucket(env);
  if (!bucket) {
    return json({ error: "file storage (R2) is not configured", code: "unavailable" }, 503);
  }
  const canWrite = caller.role === "intern" || caller.role === "mentor";

  // GET /attachments -> list
  if (request.method === "GET" && tail.length === 0) {
    return json({ attachments: await stub.listAttachments() });
  }

  // POST /attachments -> upload (multipart 'file')
  if (request.method === "POST" && tail.length === 0) {
    if (!canWrite) return json({ error: "your role cannot upload files", code: "forbidden" }, 403);
    let file: unknown;
    try {
      file = (await request.formData()).get("file");
    } catch {
      return json({ error: "expected multipart/form-data with a 'file' field", code: "bad_request" }, 400);
    }
    if (!(file instanceof File) || file.size === 0) {
      return json({ error: "a non-empty 'file' field is required", code: "bad_request" }, 400);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return json({ error: `file exceeds ${MAX_ATTACHMENT_BYTES} bytes`, code: "too_large" }, 413);
    }

    const attachmentId = crypto.randomUUID();
    const filename = file.name || "upload";
    const contentType = file.type || "application/octet-stream";
    const key = attachmentKey(workspaceId, attachmentId, filename);

    await bucket.put(key, file.stream(), { httpMetadata: { contentType } });

    const extractable = isExtractable(filename, contentType);
    const attachment = await stub.createAttachment({
      id: attachmentId,
      filename,
      contentType,
      size: file.size,
      uploaderId: caller.userId,
      uploaderName: caller.displayName,
      indexStatus: extractable ? "pending" : "unsupported",
    });

    if (extractable) {
      try {
        await env.HISTORY_QUEUE.send({ document: true, workspaceId, attachmentId } satisfies DocumentIndexEvent);
      } catch (err) {
        console.error("document index enqueue failed (non-fatal)", err);
      }
    }
    return json({ attachment }, 201);
  }

  const attachmentId = tail[0];
  const sub = tail[1];

  // GET /attachments/:id/download -> stream from R2
  if (request.method === "GET" && attachmentId && sub === "download") {
    const att = await stub.getAttachment(attachmentId);
    if (!att) return json({ error: "attachment not found", code: "not_found" }, 404);
    const obj = await bucket.get(attachmentKey(workspaceId, attachmentId, att.filename));
    if (!obj) return json({ error: "file missing from storage", code: "not_found" }, 404);

    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("content-length", String(att.size));
    const disposition = url.searchParams.get("inline") === "1" ? "inline" : "attachment";
    headers.set("content-disposition", `${disposition}; filename="${safeFilename(att.filename)}"`);
    headers.set("cache-control", "private, max-age=60");
    return new Response(obj.body, { headers });
  }

  // DELETE /attachments/:id
  if (request.method === "DELETE" && attachmentId && !sub) {
    if (!canWrite) return json({ error: "your role cannot delete files", code: "forbidden" }, 403);
    const att = await stub.deleteAttachment(attachmentId);
    if (!att) return json({ error: "attachment not found", code: "not_found" }, 404);
    try {
      await bucket.delete(attachmentKey(workspaceId, attachmentId, att.filename));
    } catch (err) {
      console.error("R2 delete failed (non-fatal)", err);
    }
    if (att.chunkCount > 0 && env.VECTORIZE) {
      try {
        await env.VECTORIZE.deleteByIds(
          Array.from({ length: att.chunkCount }, (_, i) => `doc::${workspaceId}::${attachmentId}::${i}`),
        );
      } catch (err) {
        console.error("Vectorize doc-chunk delete failed (non-fatal)", err);
      }
    }
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}

async function handleWeekly(
  env: Env,
  stub: WorkspaceStub,
  request: Request,
  workspaceId: string,
  caller: Caller,
  tail: string[],
): Promise<Response> {
  const sendWeekly = async (
    reportId: string,
    ev: { type: string; payload: unknown },
  ): Promise<void> => {
    const instance = await env.WEEKLY_WORKFLOW.get(`weekly-${reportId}`);
    await instance.sendEvent(ev);
  };

  // POST /weekly  -> start a review
  if (request.method === "POST" && tail.length === 0) {
    if (caller.role === "manager") {
      return json({ error: "only an intern or mentor can start a weekly review", code: "forbidden" }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as { reportingPeriod?: unknown };
    const period = typeof body.reportingPeriod === "string" && body.reportingPeriod ? body.reportingPeriod : isoWeek();
    const { report, created } = await stub.createWeeklyReport(period, caller.userId);
    if (created) {
      const instanceId = `weekly-${report.id}`;
      try {
        await env.WEEKLY_WORKFLOW.create({
          id: instanceId,
          params: { workspaceId, reportId: report.id, reportingPeriod: report.reportingPeriod },
        });
        await stub.setWeeklyWorkflowInstance(report.id, instanceId);
      } catch (err) {
        if (!/exist/i.test(String((err as Error)?.message ?? err))) throw err;
      }
    }
    return json({ report }, created ? 201 : 200);
  }

  // GET /weekly -> list. Managers see everything too — they need visibility
  // into SUBMITTED/RESUBMITTED reports to know when an override is warranted.
  if (request.method === "GET" && tail.length === 0) {
    return json({ reports: await stub.listWeeklyReports() });
  }

  const reportId = tail[0];
  const sub = tail[1];

  // GET /weekly/:id
  if (request.method === "GET" && reportId && !sub) {
    const report = await stub.getWeeklyReport(reportId);
    if (!report) return json({ error: "report not found", code: "not_found" }, 404);
    return json({ report });
  }

  // PATCH /weekly/:id  -> intern edits the draft
  if (request.method === "PATCH" && reportId && !sub) {
    if (caller.role !== "intern") {
      return json({ error: "only the intern can edit the draft", code: "forbidden" }, 403);
    }
    const cur = await stub.getWeeklyReport(reportId);
    if (!cur) return json({ error: "report not found", code: "not_found" }, 404);
    if (cur.status !== "DRAFT" && cur.status !== "CHANGES_REQUESTED") {
      return json({ error: "report is locked for review", code: "conflict" }, 409);
    }
    const body = (await request.json().catch(() => ({}))) as { draftContent?: unknown };
    if (typeof body.draftContent !== "string") {
      return json({ error: "draftContent (string) required", code: "bad_request" }, 400);
    }
    return json({ report: await stub.updateWeeklyDraft(reportId, body.draftContent) });
  }

  // POST /weekly/:id/submit  -> intern submits
  if (request.method === "POST" && reportId && sub === "submit") {
    if (caller.role !== "intern") {
      return json({ error: "only the intern can submit the report", code: "forbidden" }, 403);
    }
    const cur = await stub.getWeeklyReport(reportId);
    if (!cur) return json({ error: "report not found", code: "not_found" }, 404);
    if (cur.status !== "DRAFT" && cur.status !== "CHANGES_REQUESTED") {
      return json({ error: `cannot submit a report that is ${cur.status}`, code: "conflict" }, 409);
    }
    try {
      await sendWeekly(reportId, { type: "weekly.submit", payload: {} });
    } catch {
      return json({ error: "the review workflow is no longer active; start a new review", code: "conflict" }, 409);
    }
    return json({ ok: true });
  }

  // POST /weekly/:id/review  -> mentor approves or requests changes
  if (request.method === "POST" && reportId && sub === "review") {
    if (caller.role !== "mentor") {
      return json({ error: "only a mentor can review the report", code: "forbidden" }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      decision?: unknown;
      feedback?: unknown;
    };
    const decision = body.decision;
    if (decision !== "APPROVE" && decision !== "REQUEST_CHANGES") {
      return json({ error: "decision must be APPROVE or REQUEST_CHANGES", code: "bad_request" }, 400);
    }
    const cur = await stub.getWeeklyReport(reportId);
    if (!cur) return json({ error: "report not found", code: "not_found" }, 404);
    if (cur.status !== "SUBMITTED" && cur.status !== "RESUBMITTED") {
      return json({ error: `report is not awaiting review (status ${cur.status})`, code: "conflict" }, 409);
    }
    try {
      await sendWeekly(reportId, {
        type: "weekly.review",
        payload: {
          decision: decision as WeeklyReviewDecision,
          feedback: typeof body.feedback === "string" ? body.feedback : null,
        },
      });
    } catch {
      return json({ error: "the review workflow is no longer active; start a new review", code: "conflict" }, 409);
    }
    return json({ ok: true });
  }

  // POST /weekly/:id/override -> manager overrides a stuck mentor review
  if (request.method === "POST" && reportId && sub === "override") {
    if (caller.role !== "manager") {
      return json({ error: "only a manager can override a review", code: "forbidden" }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      decision?: unknown;
      note?: unknown;
    };
    const decision = body.decision;
    if (decision !== "APPROVE" && decision !== "REQUEST_CHANGES") {
      return json({ error: "decision must be APPROVE or REQUEST_CHANGES", code: "bad_request" }, 400);
    }
    if (typeof body.note !== "string" || !body.note.trim()) {
      return json({ error: "note (string) is required for an override", code: "bad_request" }, 400);
    }
    const cur = await stub.getWeeklyReport(reportId);
    if (!cur) return json({ error: "report not found", code: "not_found" }, 404);
    if (cur.status !== "SUBMITTED" && cur.status !== "RESUBMITTED") {
      return json(
        { error: `override only applies while a review is pending (status ${cur.status})`, code: "conflict" },
        409,
      );
    }
    try {
      await sendWeekly(reportId, {
        type: "weekly.review",
        payload: {
          decision: decision as WeeklyReviewDecision,
          feedback: body.note,
          overriddenBy: caller.userId,
          overriddenByName: caller.displayName,
        },
      });
    } catch {
      return json({ error: "the review workflow is no longer active; start a new review", code: "conflict" }, 409);
    }
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}

// --- Workspace creation + member management (mentor/manager only) ------------

function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${base || "workspace"}-${crypto.randomUUID().slice(0, 6)}`;
}

async function upsertUser(env: Env, input: { email: string; displayName: string }): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO users (id, email, display_name, account_status, platform_role, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', 'USER', ?, ?)",
  )
    .bind(id, email, input.displayName.trim() || email, now, now)
    .run();
  return id;
}

async function findUserIdByEmail(env: Env, email: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email.trim().toLowerCase())
    .first<{ id: string }>();
  return row?.id ?? null;
}

interface PersonInput {
  email: string;
  displayName: string;
}

function validatePerson(v: unknown, field: string): PersonInput {
  if (!v || typeof v !== "object") throw new Error(`${field} is required`);
  const p = v as Record<string, unknown>;
  if (typeof p.email !== "string" || !p.email.includes("@")) {
    throw new Error(`${field}.email must be a valid email`);
  }
  if (typeof p.displayName !== "string" || !p.displayName.trim()) {
    throw new Error(`${field}.displayName is required`);
  }
  return { email: p.email, displayName: p.displayName };
}

/**
 * DEMO workspace creation — unchanged from the pre-Access model. `devRole` is
 * a self-asserted claim honoured ONLY here, because no membership can exist
 * yet for a not-yet-created workspace, and ONLY within the demo sandbox
 * (the created workspace is always is_demo = 1, so it can never be reached
 * from a production route).
 */
async function handleDemoCreateWorkspace(env: Env, url: URL, request: Request): Promise<Response> {
  const userId = url.searchParams.get("userId") || "";
  const devRole = url.searchParams.get("devRole");
  const callerRole: Role | null = DEV_ROLES.includes(devRole as Role) ? (devRole as Role) : null;
  if (callerRole !== "mentor" && callerRole !== "manager") {
    return json({ error: "only a mentor or manager can create a workspace", code: "forbidden" }, 403);
  }
  if (!userId) return json({ error: "userId is required", code: "bad_request" }, 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "malformed JSON body", code: "bad_request" }, 400);
  }

  let intern: PersonInput, mentor: PersonInput, manager: PersonInput;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  try {
    if (!name) throw new Error("name is required");
    intern = validatePerson(body.intern, "intern");
    mentor = validatePerson(body.mentor, "mentor");
    manager = validatePerson(body.manager, "manager");
  } catch (err) {
    return json({ error: (err as Error).message, code: "bad_request" }, 400);
  }

  const workspaceId = crypto.randomUUID();
  const slug = slugify(name);

  const internId = await upsertUser(env, intern);
  const mentorId = await upsertUser(env, mentor);
  const managerId = await upsertUser(env, manager);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO workspaces (id, name, slug, is_demo) VALUES (?, ?, ?, 1)").bind(
      workspaceId,
      name,
      slug,
    ),
    env.DB.prepare(
      "INSERT INTO memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, 'intern')",
    ).bind(crypto.randomUUID(), workspaceId, internId),
    env.DB.prepare(
      "INSERT INTO memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, 'mentor')",
    ).bind(crypto.randomUUID(), workspaceId, mentorId),
    env.DB.prepare(
      "INSERT INTO memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, 'manager')",
    ).bind(crypto.randomUUID(), workspaceId, managerId),
  ]);

  return json({ workspace: { id: workspaceId, name, slug } }, 201);
}

/**
 * PRODUCTION workspace creation. The caller must be an authenticated, ACTIVE
 * production user who declares whether they're creating as a mentor or a
 * manager (`creatorRole`) — never as an intern (interns join via invitation
 * only, per the onboarding model). The declared role must match the email
 * the caller supplied in that same slot, so a caller can't grant a
 * privileged role to somebody else's email while claiming a lesser role for
 * themselves.
 *
 * For each of intern/mentor/manager: if a D1 user already exists for that
 * email, membership is granted immediately; otherwise a PENDING invitation
 * is created for them to accept on first login.
 */
async function handleCreateWorkspace(env: Env, request: Request, creator: ProductionUser): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "malformed JSON body", code: "bad_request" }, 400);
  }

  const creatorRole = body.creatorRole;
  if (creatorRole !== "mentor" && creatorRole !== "manager") {
    return json(
      { error: "creatorRole must be 'mentor' or 'manager' — a new workspace cannot be self-created as intern", code: "bad_request" },
      400,
    );
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  let intern: PersonInput, mentor: PersonInput, manager: PersonInput;
  try {
    if (!name) throw new Error("name is required");
    intern = validatePerson(body.intern, "intern");
    mentor = validatePerson(body.mentor, "mentor");
    manager = validatePerson(body.manager, "manager");
  } catch (err) {
    return json({ error: (err as Error).message, code: "bad_request" }, 400);
  }

  const creatorSlot = creatorRole === "mentor" ? mentor : manager;
  if (creatorSlot.email.trim().toLowerCase() !== creator.email.toLowerCase()) {
    return json(
      {
        error: `creatorRole is '${creatorRole}' but the ${creatorRole} email you provided doesn't match your own account email`,
        code: "bad_request",
      },
      400,
    );
  }

  const team = typeof body.team === "string" && body.team.trim() ? body.team.trim() : null;
  const startDate = typeof body.startDate === "string" && body.startDate.trim() ? body.startDate.trim() : null;
  const endDate = typeof body.endDate === "string" && body.endDate.trim() ? body.endDate.trim() : null;

  const workspaceId = crypto.randomUUID();
  const slug = slugify(name);

  await env.DB.prepare(
    "INSERT INTO workspaces (id, name, slug, is_demo, team, start_date, end_date) VALUES (?, ?, ?, 0, ?, ?, ?)",
  )
    .bind(workspaceId, name, slug, team, startDate, endDate)
    .run();
  await env.DB.prepare("INSERT INTO memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), workspaceId, creator.id, creatorRole)
    .run();
  await recordAudit(env, {
    actorUserId: creator.id,
    action: "WORKSPACE_CREATED",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    metadata: { name, creatorRole },
  });

  const slots: Array<{ role: Role; person: PersonInput }> = [
    { role: "intern", person: intern },
    { role: "mentor", person: mentor },
    { role: "manager", person: manager },
  ];
  const invited: Array<{ email: string; role: Role }> = [];
  for (const slot of slots) {
    const email = slot.person.email.trim().toLowerCase();
    if (email === creator.email.toLowerCase()) continue; // creator already added above
    const existingUserId = await findUserIdByEmail(env, email);
    if (existingUserId) {
      await env.DB.prepare("INSERT INTO memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), workspaceId, existingUserId, slot.role)
        .run();
      await recordAudit(env, {
        actorUserId: creator.id,
        action: "MEMBERSHIP_ADDED",
        targetType: "membership",
        targetId: existingUserId,
        workspaceId,
        metadata: { role: slot.role, via: "workspace_creation" },
      });
    } else {
      await createInvitation(env, { workspaceId, email, role: slot.role, invitedByUserId: creator.id });
      invited.push({ email, role: slot.role });
    }
  }

  return json({ workspace: { id: workspaceId, name, slug }, invited }, 201);
}

/** DEMO member add — unchanged, scoped to an is_demo workspace by the caller. */
async function handleAddMember(
  env: Env,
  request: Request,
  workspaceId: string,
  caller: Caller,
): Promise<Response> {
  if (caller.role !== "mentor" && caller.role !== "manager") {
    return json({ error: "only a mentor or manager can add members", code: "forbidden" }, 403);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "malformed JSON body", code: "bad_request" }, 400);
  }
  let person: PersonInput;
  try {
    person = validatePerson(body, "member");
  } catch (err) {
    return json({ error: (err as Error).message, code: "bad_request" }, 400);
  }
  const role = body.role;
  if (role !== "intern" && role !== "mentor" && role !== "manager") {
    return json({ error: "role must be intern, mentor, or manager", code: "bad_request" }, 400);
  }

  const userId = await upsertUser(env, person);
  const existing = await env.DB.prepare(
    "SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?",
  )
    .bind(workspaceId, userId)
    .first();
  if (existing) {
    return json({ error: "already a member of this workspace", code: "conflict" }, 409);
  }
  await env.DB.prepare(
    "INSERT INTO memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), workspaceId, userId, role)
    .run();

  return json({ member: { userId, displayName: person.displayName, role } }, 201);
}

/**
 * GET /api/me — production only. Resolves who the caller is, what workspace
 * memberships and pending invitations they have, and platform-admin status.
 * The client uses this to route first-login onboarding vs. the dashboard.
 */
async function handleMe(env: Env, user: ProductionUser): Promise<Response> {
  const { results: memberships } = await env.DB.prepare(
    `SELECT w.id AS workspaceId, w.name AS workspaceName, w.slug, m.role
       FROM memberships m
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ? AND w.is_demo = 0
      ORDER BY m.created_at ASC`,
  )
    .bind(user.id)
    .all();
  const pendingInvitations = await listPendingInvitationsForEmailEnriched(env, user.email);

  return json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      accountStatus: user.accountStatus,
      isAdmin: user.platformRole === "ADMIN",
    },
    memberships,
    pendingInvitations,
  });
}

/** PATCH /api/me — self-service display name update only (email/identity are Access-owned). */
async function handleUpdateMe(env: Env, request: Request, user: ProductionUser): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { displayName?: unknown };
  if (typeof body.displayName !== "string" || !body.displayName.trim()) {
    return json({ error: "displayName (non-empty string) is required", code: "bad_request" }, 400);
  }
  const updated = await updateDisplayName(env, user.id, body.displayName);
  if (!updated) return json({ error: "update failed", code: "bad_request" }, 400);
  return json({
    user: {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      accountStatus: updated.accountStatus,
      isAdmin: updated.platformRole === "ADMIN",
    },
  });
}

async function handleAcceptInvitation(env: Env, request: Request, user: ProductionUser, invitationId: string): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const result = await acceptInvitation(env, { invitationId, user });
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : result.code === "email_mismatch" ? 403 : 409;
    return json({ error: `invitation ${result.code.replace("_", " ")}`, code: result.code }, status);
  }
  return json({ invitation: result.invitation, membershipCreated: result.membershipCreated });
}

async function routeApi(request: Request, env: Env, url: URL, pathname: string, demoMode: boolean): Promise<Response> {
  if (pathname === "/api/workspaces" && request.method === "GET") {
    try {
      if (demoMode) {
        const { results } = await env.DB.prepare(
          "SELECT id, name, slug, created_at AS createdAt FROM workspaces WHERE is_demo = 1 ORDER BY created_at DESC",
        ).all();
        return json({ workspaces: results });
      }
      const userOrResponse = await requireProductionUser(request, env);
      if (userOrResponse instanceof Response) return userOrResponse;
      const { results } = await env.DB.prepare(
        `SELECT w.id, w.name, w.slug, w.created_at AS createdAt
           FROM workspaces w
           JOIN memberships m ON m.workspace_id = w.id
          WHERE m.user_id = ? AND w.is_demo = 0
          ORDER BY w.created_at DESC`,
      )
        .bind(userOrResponse.id)
        .all();
      return json({ workspaces: results });
    } catch {
      return json({ workspaces: [], note: "D1 not migrated yet — run `npm run db:migrate:local`" });
    }
  }

  if (pathname === "/api/workspaces" && request.method === "POST") {
    if (demoMode) return handleDemoCreateWorkspace(env, url, request);
    const userOrResponse = await requireProductionUser(request, env);
    if (userOrResponse instanceof Response) return userOrResponse;
    return handleCreateWorkspace(env, request, userOrResponse);
  }

  if (pathname === "/api/overview" && request.method === "GET") {
    const callerOrResponse = await resolveCaller(request, env, url, demoMode);
    if (callerOrResponse instanceof Response) return callerOrResponse;
    return demoMode ? handleDemoOverview(env, callerOrResponse.userId) : handleOverview(env, callerOrResponse.userId);
  }

  if (pathname === "/api/me" && request.method === "GET") {
    if (demoMode) return json({ error: "not available in demo mode", code: "not_found" }, 404);
    const userOrResponse = await requireProductionUser(request, env);
    if (userOrResponse instanceof Response) return userOrResponse;
    return handleMe(env, userOrResponse);
  }

  if (pathname === "/api/me" && request.method === "PATCH") {
    if (demoMode) return json({ error: "not available in demo mode", code: "not_found" }, 404);
    const userOrResponse = await requireProductionUser(request, env);
    if (userOrResponse instanceof Response) return userOrResponse;
    return handleUpdateMe(env, request, userOrResponse);
  }

  if (pathname.match(/^\/api\/invitations\/[^/]+\/accept$/) && !demoMode) {
    const userOrResponse = await requireProductionUser(request, env);
    if (userOrResponse instanceof Response) return userOrResponse;
    const invitationId = decodeURIComponent(pathname.split("/")[3]);
    return handleAcceptInvitation(env, request, userOrResponse, invitationId);
  }

  if (pathname.startsWith("/api/admin/") && !demoMode) {
    const userOrResponse = await requireProductionUser(request, env);
    if (userOrResponse instanceof Response) return userOrResponse;
    if (userOrResponse.platformRole !== "ADMIN") {
      return json({ error: "platform admin only", code: "forbidden" }, 403);
    }
    const tail = pathname.replace(/^\/api\/admin\//, "").split("/").filter(Boolean);
    return handleAdminRoute(env, request, url, tail, userOrResponse);
  }

  // Phase 4B: reminders + weekly review + invitations (nested paths). Members: add-only.
  const p4b = pathname.match(/^\/api\/workspace\/([^/]+)\/(reminders|weekly|attachments|members|invitations)(\/[^?]*)?$/);
  if (p4b) {
    const workspaceId = decodeURIComponent(p4b[1]);
    if (!WORKSPACE_ID_RE.test(workspaceId)) {
      return json({ error: "invalid workspace id" }, 400);
    }
    const caller = await authWorkspace(env, request, url, workspaceId, demoMode);
    if (caller instanceof Response) return caller;
    const stub = env.WORKSPACE_DO.get(env.WORKSPACE_DO.idFromName(workspaceId));
    const tail = (p4b[3] ?? "").split("/").filter(Boolean);
    if (p4b[2] === "reminders") return handleReminders(stub, request, caller, tail);
    if (p4b[2] === "attachments") {
      return handleAttachments(env, url, request, workspaceId, stub, caller, tail);
    }
    if (p4b[2] === "invitations") {
      if (demoMode) return json({ error: "not found" }, 404);
      return handleWorkspaceInvitations(env, request, workspaceId, caller, tail);
    }
    if (p4b[2] === "members") {
      if (request.method !== "POST" || tail.length !== 0) return json({ error: "not found" }, 404);
      return handleAddMember(env, request, workspaceId, caller);
    }
    return handleWeekly(env, stub, request, workspaceId, caller, tail);
  }

  // Workspace routes: HTTP (snapshot/summary/agent) + WebSocket.
  const match = pathname.match(/^\/api\/workspace\/([^/]+)\/(ws|snapshot|summary|agent)$/);
  if (match) {
    const workspaceId = decodeURIComponent(match[1]);
    if (!WORKSPACE_ID_RE.test(workspaceId)) {
      return json({ error: "invalid workspace id" }, 400);
    }

    const stub = env.WORKSPACE_DO.get(env.WORKSPACE_DO.idFromName(workspaceId));

    // `summary` needs no identity (aggregate counts only), but must still stay
    // within the caller's mode (demo vs production) to avoid cross-namespace probing.
    if (match[2] === "summary") {
      const isDemo = await workspaceIsDemo(env, workspaceId);
      if (isDemo === null || isDemo !== demoMode) return json({ error: "not found" }, 404);
      return stub.fetch(request);
    }

    const callerOrResponse = await resolveCaller(request, env, url, demoMode);
    if (callerOrResponse instanceof Response) return callerOrResponse;
    const role = await resolveRole(env, workspaceId, callerOrResponse.userId, demoMode);

    // No membership => no access at all, for reads (snapshot) as well as
    // realtime (ws). Never forward an unmapped identity into the DO.
    if (role === null) {
      return json({ error: "you are not a member of this workspace", code: "unauthorized" }, 403);
    }

    if (match[2] === "agent") {
      return handleAgent(env, request, workspaceId, { ...callerOrResponse, role });
    }

    // Attach a Worker-authoritative identity the DO can trust; the DO never
    // re-derives identity or accepts a raw client-supplied fallback.
    const doUrl = new URL(request.url);
    doUrl.searchParams.set("_uid", callerOrResponse.userId);
    doUrl.searchParams.set("_name", callerOrResponse.displayName);
    doUrl.searchParams.set("_role", role);

    return stub.fetch(new Request(doUrl.toString(), request));
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/health") {
      let d1: HealthResponse["d1"] = "unavailable";
      try {
        await env.DB.prepare("SELECT 1").first();
        d1 = "ok";
      } catch {
        d1 = "unavailable";
      }
      return json({ ok: true, service: "internpulse", time: Date.now(), d1 } satisfies HealthResponse);
    }

    if (pathname.startsWith("/api/demo/")) {
      const rewritten = "/api/" + pathname.slice("/api/demo/".length);
      return routeApi(request, env, url, rewritten, true);
    }

    if (pathname.startsWith("/api/")) {
      return routeApi(request, env, url, pathname, false);
    }

    // Non-API paths are served by the Workers assets runtime (the React SPA).
    return new Response("Not found", { status: 404 });
  },

  // Queue consumers. history-index: Vectorize upserts for entities (Phase 4A) +
  // uploaded documents (Stage 1 finish), off the mutation path.
  // workflow-events: start durable Workflows idempotently (Phase 4B).
  async queue(batch, env): Promise<void> {
    if (batch.queue === "internpulse-workflow-events") {
      await handleWorkflowEventBatch(batch as MessageBatch<WorkflowEventMessage>, env);
    } else {
      await handleHistoryIndexBatch(
        batch as MessageBatch<HistoryIndexEvent | DocumentIndexEvent>,
        env,
      );
    }
  },
} satisfies ExportedHandler<Env, HistoryIndexEvent | DocumentIndexEvent | WorkflowEventMessage>;
