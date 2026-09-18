import { ApiError } from "../lib/api";

/** Pure mapping from an invitation-accept failure to user-facing copy. */
export function invitationErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "email_mismatch":
        return "This invitation was sent to a different email address than the one you're signed in with.";
      case "expired":
        return "This invitation has expired. Ask the workspace owner to send a new one.";
      case "not_pending":
        return "This invitation is no longer pending — it may already have been accepted or revoked.";
      case "not_found":
        return "This invitation could not be found.";
      default:
        return err.message;
    }
  }
  return "Network error — please try again.";
}
