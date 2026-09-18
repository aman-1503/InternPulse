import type { AuthState, MeFetchResult, Membership, MeUser, PendingInvitation } from "./types";

interface MeResponseBody {
  user?: MeUser;
  memberships?: Membership[];
  pendingInvitations?: PendingInvitation[];
  error?: string;
  code?: string;
}

/**
 * Pure mapping from a raw GET /api/me outcome to one of the eight explicit
 * client auth states. Kept side-effect-free and independently testable
 * (see auth.test.ts) — no component should infer auth state on its own by
 * inspecting a fetch response; everything goes through this one function.
 */
export function deriveAuthState(result: MeFetchResult): AuthState {
  if (result.kind === "network_error") return { status: "network_error" };

  const { status, body } = result;
  const parsed = (body ?? {}) as MeResponseBody;

  if (status === 200 && parsed.user) {
    return {
      status: "authenticated",
      user: parsed.user,
      memberships: parsed.memberships ?? [],
      pendingInvitations: parsed.pendingInvitations ?? [],
    };
  }

  if (status === 401) return { status: "unauthenticated" };

  if (status === 403 && parsed.code === "account_suspended") return { status: "suspended" };
  if (status === 403 && parsed.code === "account_disabled") return { status: "disabled" };
  if (status === 403) return { status: "forbidden", message: parsed.error ?? "You don't have access." };

  if (status === 409 && parsed.code === "identity_conflict") {
    return { status: "identity_conflict", message: parsed.error ?? "This identity is already linked elsewhere." };
  }

  // Unrecognized status (5xx, malformed body, etc.) — treat as a retryable
  // infrastructure failure rather than guessing at an auth meaning.
  return { status: "network_error" };
}
