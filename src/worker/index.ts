import { getAgentByName } from "agents";
import { WorkspaceDO } from "./workspace-do";
import { ProgressAgent } from "./progress-agent";
import type {
  HealthResponse,
  OverviewResponse,
  OverviewRow,
  Role,
  WorkspaceSummaryStats,
} from "../shared/protocol";

// Durable Object / Agent classes must be re-exported from the Worker's main module.
export { WorkspaceDO, ProgressAgent };

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
} satisfies ExportedHandler<Env>;
