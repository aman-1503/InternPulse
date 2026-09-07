import { getAgentByName } from "agents";
import { WorkspaceDO } from "./workspace-do";
import { ProgressAgent } from "./progress-agent";
import { BlockerWorkflow } from "./blocker-workflow";
import { WeeklyReviewWorkflow } from "./weekly-workflow";
import { handleHistoryIndexBatch, handleWorkflowEventBatch } from "./queue-consumer";
import { isoWeek } from "./reminders";
import type {
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

/**
 * Authorization boundary (DEV/DEMO).
 *
 * `userId` comes from the browser and is NOT authenticated. A real identity
 * provider will later replace this function's body; nothing downstream changes.
 * If the identity maps to a D1 membership, that role is authoritative. Otherwise
 * we honour a `devRole` query param purely so the demo is usable.
 */
async function resolveRole(
  env: Env,
  workspaceId: string,
  userId: string,
  devRole: string | null,
): Promise<Role | null> {
  try {
    const row = await env.DB.prepare(
      "SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ? LIMIT 1",
    )
      .bind(workspaceId, userId)
      .first<{ role: Role }>();
    if (row?.role) return row.role;
  } catch {
    // D1 not migrated yet — fall through to the dev fallback.
  }
  return DEV_ROLES.includes(devRole as Role) ? (devRole as Role) : null;
}

async function handleOverview(env: Env, url: URL): Promise<Response> {
  const userId = url.searchParams.get("userId") ?? "";

  let baseRows: Array<{ id: string; name: string; slug: string }>;
  let demoFallback = false;
  try {
    const managed = userId
      ? await env.DB.prepare(
          `SELECT w.id, w.name, w.slug
             FROM workspaces w
             JOIN memberships m ON m.workspace_id = w.id
            WHERE m.user_id = ? AND m.role = 'manager'
            ORDER BY w.created_at DESC`,
        )
          .bind(userId)
          .all<{ id: string; name: string; slug: string }>()
      : { results: [] as Array<{ id: string; name: string; slug: string }> };

    if (managed.results.length > 0) {
      baseRows = managed.results;
    } else {
      demoFallback = true;
      const all = await env.DB.prepare(
        "SELECT id, name, slug FROM workspaces ORDER BY created_at DESC",
      ).all<{ id: string; name: string; slug: string }>();
      baseRows = all.results;
    }
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

/**
 * Progress Agent endpoint. Goes through the SAME authorization boundary as
 * every other workspace route: a caller with no resolvable role is rejected.
 *   GET  -> this user's conversation history with the workspace agent
 *   POST -> ask the agent a question ({ prompt }); response is grounded in
 *           current authoritative WorkspaceDO state.
 */
async function handleAgent(
  env: Env,
  url: URL,
  request: Request,
  workspaceId: string,
): Promise<Response> {
  const userId = url.searchParams.get("userId") || `anon-${crypto.randomUUID().slice(0, 8)}`;
  const displayName = url.searchParams.get("displayName") || "Anonymous";
  const role = await resolveRole(env, workspaceId, userId, url.searchParams.get("devRole"));

  if (role === null) {
    return json(
      { error: "you are not a member of this workspace", code: "unauthorized" },
      403,
    );
  }

  // wrangler's generated Env types the Agent namespace as untyped; re-attach the
  // concrete class so `agent.ask` / `agent.history` are visible.
  const agentNs = env.PROGRESS_AGENT as unknown as DurableObjectNamespace<ProgressAgent>;
  const agent = await getAgentByName<Env, ProgressAgent>(agentNs, workspaceId);

  if (request.method === "GET") {
    return json({ turns: await agent.history(userId) });
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
    const result = await agent.ask({ workspaceId, userId, displayName, role, prompt });
    return json(result, "error" in result ? 422 : 200);
  }

  return json({ error: "method not allowed" }, 405);
}

// --- Phase 4B: reminders + weekly review (same authorization boundary) --------

interface Caller {
  userId: string;
  displayName: string;
  role: Role;
}

async function authWorkspace(
  env: Env,
  url: URL,
  workspaceId: string,
): Promise<Caller | Response> {
  const userId = url.searchParams.get("userId") || `anon-${crypto.randomUUID().slice(0, 8)}`;
  const displayName = url.searchParams.get("displayName") || "Anonymous";
  const role = await resolveRole(env, workspaceId, userId, url.searchParams.get("devRole"));
  if (role === null) {
    return json({ error: "you are not a member of this workspace", code: "unauthorized" }, 403);
  }
  return { userId, displayName, role };
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

  // GET /weekly  -> list (managers see only APPROVED)
  if (request.method === "GET" && tail.length === 0) {
    const reports = await stub.listWeeklyReports();
    return json({
      reports: caller.role === "manager" ? reports.filter((r) => r.status === "APPROVED") : reports,
    });
  }

  const reportId = tail[0];
  const sub = tail[1];

  // GET /weekly/:id
  if (request.method === "GET" && reportId && !sub) {
    const report = await stub.getWeeklyReport(reportId);
    if (!report) return json({ error: "report not found", code: "not_found" }, 404);
    if (caller.role === "manager" && report.status !== "APPROVED") {
      return json({ error: "report is not yet finalized", code: "forbidden" }, 403);
    }
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
    if (cur.status !== "SUBMITTED") {
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

    if (pathname === "/api/workspaces" && request.method === "GET") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT id, name, slug, created_at AS createdAt FROM workspaces ORDER BY created_at DESC",
        ).all();
        return json({ workspaces: results });
      } catch {
        return json({ workspaces: [], note: "D1 not migrated yet — run `npm run db:migrate:local`" });
      }
    }

    if (pathname === "/api/overview" && request.method === "GET") {
      return handleOverview(env, url);
    }

    // Phase 4B: reminders + weekly review (nested paths).
    const p4b = pathname.match(/^\/api\/workspace\/([^/]+)\/(reminders|weekly)(\/[^?]*)?$/);
    if (p4b) {
      const workspaceId = decodeURIComponent(p4b[1]);
      if (!WORKSPACE_ID_RE.test(workspaceId)) {
        return json({ error: "invalid workspace id" }, 400);
      }
      const caller = await authWorkspace(env, url, workspaceId);
      if (caller instanceof Response) return caller;
      const stub = env.WORKSPACE_DO.get(env.WORKSPACE_DO.idFromName(workspaceId));
      const tail = (p4b[3] ?? "").split("/").filter(Boolean);
      return p4b[2] === "reminders"
        ? handleReminders(stub, request, caller, tail)
        : handleWeekly(env, stub, request, workspaceId, caller, tail);
    }

    // Workspace routes: HTTP (snapshot/summary/agent) + WebSocket.
    const match = pathname.match(/^\/api\/workspace\/([^/]+)\/(ws|snapshot|summary|agent)$/);
    if (match) {
      const workspaceId = decodeURIComponent(match[1]);
      if (!WORKSPACE_ID_RE.test(workspaceId)) {
        return json({ error: "invalid workspace id" }, 400);
      }

      // Progress Agent: same authorization boundary as the rest of the workspace.
      if (match[2] === "agent") {
        return handleAgent(env, url, request, workspaceId);
      }

      const stub = env.WORKSPACE_DO.get(env.WORKSPACE_DO.idFromName(workspaceId));

      // For realtime + snapshot, attach a Worker-authoritative identity the DO
      // can trust. `summary` needs no identity (aggregate counts only).
      if (match[2] === "summary") {
        return stub.fetch(request);
      }

      const userId = url.searchParams.get("userId") || `anon-${crypto.randomUUID().slice(0, 8)}`;
      const displayName = url.searchParams.get("displayName") || "Anonymous";
      const role = await resolveRole(env, workspaceId, userId, url.searchParams.get("devRole"));

      const doUrl = new URL(request.url);
      doUrl.searchParams.set("_uid", userId);
      doUrl.searchParams.set("_name", displayName);
      doUrl.searchParams.set("_role", role ?? "");

      return stub.fetch(new Request(doUrl.toString(), request));
    }

    if (pathname.startsWith("/api/")) {
      return json({ error: "not found" }, 404);
    }

    // Non-API paths are served by the Workers assets runtime (the React SPA).
    return new Response("Not found", { status: 404 });
  },

  // Queue consumers. Phase 4A: history-index (Vectorize upserts off the mutation
  // path). Phase 4B: workflow-events (start durable Workflows idempotently).
  async queue(batch, env): Promise<void> {
    if (batch.queue === "internpulse-workflow-events") {
      await handleWorkflowEventBatch(batch as MessageBatch<WorkflowEventMessage>, env);
    } else {
      await handleHistoryIndexBatch(batch as MessageBatch<HistoryIndexEvent>, env);
    }
  },
} satisfies ExportedHandler<Env, HistoryIndexEvent | WorkflowEventMessage>;
