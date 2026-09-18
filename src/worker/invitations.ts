/**
 * Workspace invitations. A pending invite is how a mentor/manager grants
 * membership to someone who may not have an InternPulse account yet.
 * Acceptance requires the authenticated Access email to match the invited
 * email exactly (case-insensitive) — never trust a client-supplied email or
 * role at acceptance time.
 */
import type { Role } from "../shared/protocol";
import { recordAudit } from "./audit";
import type { ProductionUser } from "./production-identity";

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  role: Role;
  invitedByUserId: string;
  status: InvitationStatus;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
}

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: Role;
  invited_by_user_id: string;
  status: InvitationStatus;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    invitedByUserId: row.invited_by_user_id,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  };
}

async function getInvitationRow(env: Env, id: string): Promise<InvitationRow | null> {
  const row = await env.DB.prepare("SELECT * FROM workspace_invitations WHERE id = ?")
    .bind(id)
    .first<InvitationRow>();
  return row ?? null;
}

/** Create a new pending invite, or refresh (resend) an existing pending one for the same (workspace, email). */
export async function createInvitation(
  env: Env,
  input: { workspaceId: string; email: string; role: Role; invitedByUserId: string },
): Promise<Invitation> {
  const email = input.email.trim().toLowerCase();
  const now = Date.now();
  const expiresAt = now + INVITE_TTL_MS;

  const existing = await env.DB.prepare(
    "SELECT id FROM workspace_invitations WHERE workspace_id = ? AND email = ? AND status = 'PENDING'",
  )
    .bind(input.workspaceId, email)
    .first<{ id: string }>();

  const id = existing?.id ?? crypto.randomUUID();
  if (existing) {
    await env.DB.prepare(
      "UPDATE workspace_invitations SET role = ?, invited_by_user_id = ?, created_at = ?, expires_at = ? WHERE id = ?",
    )
      .bind(input.role, input.invitedByUserId, now, expiresAt, id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO workspace_invitations
         (id, workspace_id, email, role, invited_by_user_id, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    )
      .bind(id, input.workspaceId, email, input.role, input.invitedByUserId, now, expiresAt)
      .run();
  }

  await recordAudit(env, {
    actorUserId: input.invitedByUserId,
    action: "INVITE_CREATED",
    targetType: "invitation",
    targetId: id,
    workspaceId: input.workspaceId,
    metadata: { email, role: input.role, resent: Boolean(existing) },
  });

  return {
    id,
    workspaceId: input.workspaceId,
    email,
    role: input.role,
    invitedByUserId: input.invitedByUserId,
    status: "PENDING",
    createdAt: now,
    expiresAt,
    acceptedAt: null,
  };
}

export async function listWorkspaceInvitations(env: Env, workspaceId: string): Promise<Invitation[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM workspace_invitations WHERE workspace_id = ? ORDER BY created_at DESC",
  )
    .bind(workspaceId)
    .all<InvitationRow>();
  return results.map(toInvitation);
}

export async function listPendingInvitationsForEmail(env: Env, email: string): Promise<Invitation[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM workspace_invitations WHERE email = ? AND status = 'PENDING' AND expires_at > ? ORDER BY created_at DESC",
  )
    .bind(email.trim().toLowerCase(), Date.now())
    .all<InvitationRow>();
  return results.map(toInvitation);
}

export interface EnrichedInvitation extends Invitation {
  workspaceName: string;
  invitedByName: string;
}

/** Same as listPendingInvitationsForEmail, with display-only fields joined in for the invitation UI. */
export async function listPendingInvitationsForEmailEnriched(
  env: Env,
  email: string,
): Promise<EnrichedInvitation[]> {
  const { results } = await env.DB.prepare(
    `SELECT wi.*, w.name AS workspace_name, u.display_name AS invited_by_name
       FROM workspace_invitations wi
       JOIN workspaces w ON w.id = wi.workspace_id
       LEFT JOIN users u ON u.id = wi.invited_by_user_id
      WHERE wi.email = ? AND wi.status = 'PENDING' AND wi.expires_at > ?
      ORDER BY wi.created_at DESC`,
  )
    .bind(email.trim().toLowerCase(), Date.now())
    .all<InvitationRow & { workspace_name: string; invited_by_name: string | null }>();
  return results.map((row) => ({
    ...toInvitation(row),
    workspaceName: row.workspace_name,
    invitedByName: row.invited_by_name ?? "a workspace admin",
  }));
}

export async function revokeInvitation(
  env: Env,
  input: { invitationId: string; workspaceId: string; actorUserId: string },
): Promise<Invitation | null> {
  const row = await getInvitationRow(env, input.invitationId);
  if (!row || row.workspace_id !== input.workspaceId || row.status !== "PENDING") return null;

  await env.DB.prepare("UPDATE workspace_invitations SET status = 'REVOKED' WHERE id = ?")
    .bind(input.invitationId)
    .run();
  await recordAudit(env, {
    actorUserId: input.actorUserId,
    action: "INVITE_REVOKED",
    targetType: "invitation",
    targetId: input.invitationId,
    workspaceId: input.workspaceId,
    metadata: { email: row.email, role: row.role },
  });
  return toInvitation({ ...row, status: "REVOKED" });
}

export type AcceptInvitationResult =
  | { ok: true; invitation: Invitation; membershipCreated: boolean }
  | { ok: false; code: "not_found" | "email_mismatch" | "not_pending" | "expired" };

/**
 * Accept an invitation as the authenticated production user. The invitation
 * id alone is never sufficient — the caller's verified email must match the
 * invited email, and only a PENDING, unexpired invite may be accepted.
 * Idempotent: re-accepting an already-accepted invite for the same user
 * would fail the status check (ACCEPTED != PENDING), so replay is rejected.
 */
export async function acceptInvitation(
  env: Env,
  input: { invitationId: string; user: ProductionUser },
): Promise<AcceptInvitationResult> {
  const row = await getInvitationRow(env, input.invitationId);
  if (!row) return { ok: false, code: "not_found" };
  if (row.email.toLowerCase() !== input.user.email.toLowerCase()) {
    return { ok: false, code: "email_mismatch" };
  }
  if (row.status !== "PENDING") return { ok: false, code: "not_pending" };
  if (row.expires_at < Date.now()) {
    await env.DB.prepare("UPDATE workspace_invitations SET status = 'EXPIRED' WHERE id = ?")
      .bind(row.id)
      .run();
    return { ok: false, code: "expired" };
  }

  const now = Date.now();
  const existingMembership = await env.DB.prepare(
    "SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?",
  )
    .bind(row.workspace_id, input.user.id)
    .first();

  let membershipCreated = false;
  if (!existingMembership) {
    await env.DB.prepare("INSERT INTO memberships (id, workspace_id, user_id, role) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), row.workspace_id, input.user.id, row.role)
      .run();
    membershipCreated = true;
    await recordAudit(env, {
      actorUserId: input.user.id,
      action: "MEMBERSHIP_ADDED",
      targetType: "membership",
      targetId: input.user.id,
      workspaceId: row.workspace_id,
      metadata: { role: row.role, via: "invitation" },
    });
  }

  await env.DB.prepare("UPDATE workspace_invitations SET status = 'ACCEPTED', accepted_at = ? WHERE id = ?")
    .bind(now, row.id)
    .run();
  await recordAudit(env, {
    actorUserId: input.user.id,
    action: "INVITE_ACCEPTED",
    targetType: "invitation",
    targetId: row.id,
    workspaceId: row.workspace_id,
  });

  return {
    ok: true,
    invitation: toInvitation({ ...row, status: "ACCEPTED", accepted_at: now }),
    membershipCreated,
  };
}
