/**
 * Production API client. Same-origin fetches only — no identity query
 * params, ever (the Access session at the edge carries identity). Every
 * function throws ApiError on a non-2xx response so callers get a
 * consistent, typed shape to render.
 */
import type { MeUser } from "../auth/types";
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      typeof body.error === "string" ? body.error : `Request failed (${res.status})`,
      res.status,
      typeof body.code === "string" ? body.code : undefined,
    );
  }
  return body as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return json<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchJson<T>(url: string, body: unknown): Promise<T> {
  return json<T>(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// -- profile -----------------------------------------------------------

export function updateDisplayName(displayName: string): Promise<{ user: MeUser }> {
  return patchJson("/api/me", { displayName });
}

// -- workspaces --------------------------------------------------------

export interface CreateWorkspaceInput {
  name: string;
  creatorRole: "mentor" | "manager";
  intern: { email: string; displayName: string };
  mentor: { email: string; displayName: string };
  manager: { email: string; displayName: string };
  team?: string;
  startDate?: string;
  endDate?: string;
}

export interface CreateWorkspaceResult {
  workspace: { id: string; name: string; slug: string };
  invited: Array<{ email: string; role: string }>;
}

export function createWorkspace(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
  return postJson("/api/workspaces", input);
}

// -- invitations ---------------------------------------------------------

export interface AcceptInvitationResult {
  invitation: { id: string; status: string };
  membershipCreated: boolean;
}

export function acceptInvitation(invitationId: string): Promise<AcceptInvitationResult> {
  return postJson(`/api/invitations/${encodeURIComponent(invitationId)}/accept`, {});
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  invitedByUserId: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
}

export function listWorkspaceInvitations(workspaceId: string): Promise<{ invitations: WorkspaceInvitation[] }> {
  return json(`/api/workspace/${encodeURIComponent(workspaceId)}/invitations`);
}

export function inviteToWorkspace(
  workspaceId: string,
  input: { email: string; role: "intern" | "mentor" | "manager" },
): Promise<{ invitation: WorkspaceInvitation }> {
  return postJson(`/api/workspace/${encodeURIComponent(workspaceId)}/invitations`, input);
}

export function revokeWorkspaceInvitation(
  workspaceId: string,
  invitationId: string,
): Promise<{ invitation: WorkspaceInvitation }> {
  return postJson(`/api/workspace/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}/revoke`, {});
}

// -- workspace member list (production snapshot already includes members,
//    but the settings screen wants it standalone too) ---------------------

export interface WorkspaceListRow {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
}

export function listMyWorkspaces(): Promise<{ workspaces: WorkspaceListRow[] }> {
  return json("/api/workspaces");
}

// -- admin -----------------------------------------------------------------

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  accountStatus: "ACTIVE" | "SUSPENDED" | "DISABLED";
  platformRole: "USER" | "ADMIN";
  createdAt: number;
  lastLoginAt: number | null;
}

export function adminListUsers(): Promise<{ users: AdminUserRow[] }> {
  return json("/api/admin/users");
}

export function adminSetUserStatus(
  userId: string,
  action: "suspend" | "activate" | "disable",
): Promise<{ user: AdminUserRow }> {
  return postJson(`/api/admin/users/${encodeURIComponent(userId)}/${action}`, {});
}

export interface AdminWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  isDemo: number;
  createdAt: number;
  memberCount: number;
}

export function adminListWorkspaces(): Promise<{ workspaces: AdminWorkspaceRow[] }> {
  return json("/api/admin/workspaces");
}

export interface AdminMemberRow {
  userId: string;
  email: string;
  displayName: string;
  role: "intern" | "mentor" | "manager";
  createdAt: number;
}

export function adminListMembers(workspaceId: string): Promise<{ members: AdminMemberRow[] }> {
  return json(`/api/admin/workspaces/${encodeURIComponent(workspaceId)}/members`);
}

export function adminRepairMembership(
  workspaceId: string,
  input: { userId: string; role: "intern" | "mentor" | "manager" },
): Promise<{ ok: true }> {
  return postJson(`/api/admin/workspaces/${encodeURIComponent(workspaceId)}/members`, input);
}

export async function adminRemoveMembership(workspaceId: string, userId: string): Promise<{ ok: true }> {
  return json(`/api/admin/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export function adminListInvitations(workspaceId?: string): Promise<{ invitations: WorkspaceInvitation[] }> {
  const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  return json(`/api/admin/invitations${qs}`);
}

export function adminRevokeInvitation(invitationId: string, workspaceId: string): Promise<{ invitation: WorkspaceInvitation }> {
  return postJson(`/api/admin/invitations/${encodeURIComponent(invitationId)}/revoke`, { workspaceId });
}

export interface AuditEventRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  workspace_id: string | null;
  metadata_json: string | null;
  created_at: number;
}

export function adminListAudit(workspaceId?: string): Promise<{ events: AuditEventRow[] }> {
  const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
  return json(`/api/admin/audit${qs}`);
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  time: number;
  d1: "ok" | "unavailable";
}

export function getHealth(): Promise<HealthResponse> {
  return json("/api/health");
}
