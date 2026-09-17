/**
 * Platform admin operational/support endpoints. Admin is authority to help
 * operate the platform (user/account/membership repair, visibility into
 * invitations and audit history) — it is deliberately NOT "manager of every
 * workspace" and must never touch workspace-local content (tasks, updates,
 * weekly report text, feedback). Every mutation here is audited.
 *
 * Callers must already have been verified as platform_role === 'ADMIN' by
 * the caller (see requireAdmin in index.ts) before any handler here runs.
 */
import type { Role } from "../shared/protocol";
import { recordAudit } from "./audit";
import { revokeInvitation } from "./invitations";
import { getUserById, setAccountStatus, type ProductionUser } from "./production-identity";

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

async function listUsers(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, email, display_name AS displayName, account_status AS accountStatus,
            platform_role AS platformRole, created_at AS createdAt, last_login_at AS lastLoginAt
       FROM users
      ORDER BY created_at DESC
      LIMIT 500`,
  ).all();
  return json({ users: results });
}

async function suspendOrActivate(
  env: Env,
  admin: ProductionUser,
  targetUserId: string,
  status: "ACTIVE" | "SUSPENDED" | "DISABLED",
): Promise<Response> {
  if (targetUserId === admin.id && status !== "ACTIVE") {
    return json({ error: "cannot suspend your own admin account", code: "forbidden" }, 400);
  }
  const updated = await setAccountStatus(env, targetUserId, status, admin.id);
  if (!updated) return json({ error: "user not found", code: "not_found" }, 404);
  return json({ user: updated });
}

async function listAudit(env: Env, url: URL): Promise<Response> {
  const workspaceId = url.searchParams.get("workspaceId");
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
  const query = workspaceId
    ? env.DB.prepare(
        "SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
      ).bind(workspaceId, limit)
    : env.DB.prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?").bind(limit);
  const { results } = await query.all();
  return json({ events: results });
}

async function listWorkspaces(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.name, w.slug, w.is_demo AS isDemo, w.created_at AS createdAt,
            (SELECT COUNT(*) FROM memberships m WHERE m.workspace_id = w.id) AS memberCount
       FROM workspaces w
      ORDER BY w.created_at DESC`,
  ).all();
  return json({ workspaces: results });
}

async function listMembers(env: Env, workspaceId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT u.id AS userId, u.email, u.display_name AS displayName, m.role, m.created_at AS createdAt
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ?
      ORDER BY m.created_at ASC`,
  )
    .bind(workspaceId)
    .all();
  return json({ members: results });
}

async function repairMembership(
  env: Env,
  admin: ProductionUser,
  workspaceId: string,
  request: Request,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    userId?: unknown;
    role?: unknown;
  };
  const userId = typeof body.userId === "string" ? body.userId : null;
  const role = body.role;
  if (!userId) return json({ error: "userId is required", code: "bad_request" }, 400);
  if (role !== "intern" && role !== "mentor" && role !== "manager") {
    return json({ error: "role must be intern, mentor, or manager", code: "bad_request" }, 400);
  }
  const target = await getUserById(env, userId);
  if (!target) return json({ error: "user not found", code: "not_found" }, 404);

  const existing = await env.DB.prepare(
    "SELECT id, role FROM memberships WHERE workspace_id = ? AND user_id = ?",
  )
    .bind(workspaceId, userId)
    .first<{ id: string; role: Role }>();

  if (existing) {
    if (existing.role === role) return json({ error: "already has this role", code: "conflict" }, 409);
    await env.DB.prepare("UPDATE memberships SET role = ? WHERE id = ?").bind(role, existing.id).run();
    await recordAudit(env, {
      actorUserId: admin.id,
      action: "MEMBERSHIP_ROLE_CHANGED",
      targetType: "membership",
      targetId: userId,
      workspaceId,
      metadata: { from: existing.role, to: role, via: "admin" },
    });
  } else {
    await env.DB.prepare("INSERT INTO memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), workspaceId, userId, role)
      .run();
    await recordAudit(env, {
      actorUserId: admin.id,
      action: "MEMBERSHIP_ADDED",
      targetType: "membership",
      targetId: userId,
      workspaceId,
      metadata: { role, via: "admin" },
    });
  }

  return json({ ok: true });
}

async function removeMembership(
  env: Env,
  admin: ProductionUser,
  workspaceId: string,
  targetUserId: string,
): Promise<Response> {
  const existing = await env.DB.prepare(
    "SELECT id, role FROM memberships WHERE workspace_id = ? AND user_id = ?",
  )
    .bind(workspaceId, targetUserId)
    .first<{ id: string; role: Role }>();
  if (!existing) return json({ error: "membership not found", code: "not_found" }, 404);

  if (existing.role === "manager") {
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'manager'",
    )
      .bind(workspaceId)
      .all<{ n: number }>();
    if ((results[0]?.n ?? 0) <= 1) {
      return json(
        { error: "cannot remove the last manager — assign another manager first", code: "conflict" },
        409,
      );
    }
  }

  await env.DB.prepare("DELETE FROM memberships WHERE id = ?").bind(existing.id).run();
  await recordAudit(env, {
    actorUserId: admin.id,
    action: "MEMBERSHIP_REMOVED",
    targetType: "membership",
    targetId: targetUserId,
    workspaceId,
    metadata: { role: existing.role, via: "admin" },
  });
  return json({ ok: true });
}

async function listInvitations(env: Env, url: URL): Promise<Response> {
  const workspaceId = url.searchParams.get("workspaceId");
  const query = workspaceId
    ? env.DB.prepare(
        "SELECT * FROM workspace_invitations WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 500",
      ).bind(workspaceId)
    : env.DB.prepare("SELECT * FROM workspace_invitations ORDER BY created_at DESC LIMIT 500");
  const { results } = await query.all();
  return json({ invitations: results });
}

/** Routes: everything under /api/admin/*. `tail` is the path split on '/' after "admin". */
export async function handleAdminRoute(
  env: Env,
  request: Request,
  url: URL,
  tail: string[],
  admin: ProductionUser,
): Promise<Response> {
  const [resource, id, sub, subId] = tail;

  if (resource === "users" && !id && request.method === "GET") return listUsers(env);
  if (resource === "users" && id && sub === "suspend" && request.method === "POST") {
    return suspendOrActivate(env, admin, id, "SUSPENDED");
  }
  if (resource === "users" && id && sub === "activate" && request.method === "POST") {
    return suspendOrActivate(env, admin, id, "ACTIVE");
  }
  if (resource === "users" && id && sub === "disable" && request.method === "POST") {
    return suspendOrActivate(env, admin, id, "DISABLED");
  }

  if (resource === "audit" && !id && request.method === "GET") return listAudit(env, url);

  if (resource === "workspaces" && !id && request.method === "GET") return listWorkspaces(env);
  if (resource === "workspaces" && id && sub === "members" && !subId && request.method === "GET") {
    return listMembers(env, id);
  }
  if (resource === "workspaces" && id && sub === "members" && !subId && request.method === "POST") {
    return repairMembership(env, admin, id, request);
  }
  if (resource === "workspaces" && id && sub === "members" && subId && request.method === "DELETE") {
    return removeMembership(env, admin, id, subId);
  }

  if (resource === "invitations" && !id && request.method === "GET") return listInvitations(env, url);
  if (resource === "invitations" && id && sub === "revoke" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: unknown };
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
    if (!workspaceId) return json({ error: "workspaceId is required", code: "bad_request" }, 400);
    const revoked = await revokeInvitation(env, { invitationId: id, workspaceId, actorUserId: admin.id });
    if (!revoked) return json({ error: "invitation not found or not pending", code: "not_found" }, 404);
    return json({ invitation: revoked });
  }

  return json({ error: "not found" }, 404);
}
