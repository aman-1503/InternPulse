import type { Role } from "../../shared/protocol";

export interface MeUser {
  id: string;
  email: string;
  displayName: string;
  accountStatus: "ACTIVE" | "SUSPENDED" | "DISABLED";
  isAdmin: boolean;
}

export interface Membership {
  workspaceId: string;
  workspaceName: string;
  slug: string;
  role: Role;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface PendingInvitation {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: Role;
  invitedByUserId: string;
  invitedByName: string;
  status: InvitationStatus;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
}

export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: MeUser; memberships: Membership[]; pendingInvitations: PendingInvitation[] }
  | { status: "unauthenticated" }
  | { status: "forbidden"; message: string }
  | { status: "suspended" }
  | { status: "disabled" }
  | { status: "identity_conflict"; message: string }
  | { status: "network_error" };

export type MeFetchResult =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "network_error" };
