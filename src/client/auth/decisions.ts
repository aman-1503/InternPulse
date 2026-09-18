import type { Role } from "../../shared/protocol";
import type { Membership, PendingInvitation } from "./types";

export type OnboardingStage = "home" | "invitations" | "onboarding";

/**
 * Pure decision for what to show right after a successful GET /api/me.
 * Deliberately never asks "what role are you" — see AUTH direction.
 */
export function deriveOnboardingStage(input: {
  memberships: Membership[];
  pendingInvitations: PendingInvitation[];
}): OnboardingStage {
  if (input.memberships.length > 0) return "home";
  if (input.pendingInvitations.length > 0) return "invitations";
  return "onboarding";
}

/**
 * A user can hold different roles across workspaces. One "home" has to be
 * chosen — precedence favors the more supervisory lens (manager > mentor >
 * intern), since a manager/mentor still reaches every workspace (including
 * ones where they're an intern-equivalent bystander, which doesn't happen
 * today) via the workspace switcher regardless of which home is default.
 */
export function deriveHomeRole(memberships: Membership[]): Role | null {
  if (memberships.some((m) => m.role === "manager")) return "manager";
  if (memberships.some((m) => m.role === "mentor")) return "mentor";
  if (memberships.some((m) => m.role === "intern")) return "intern";
  return null;
}
