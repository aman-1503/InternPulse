/**
 * Phase 2 role matrix. Deliberately tiny — not a policy engine.
 *
 *                       intern  mentor  manager  (no membership)
 *   read / snapshot        y      y       y            y
 *   task write             y      y       -            -
 *   post update            y      y       y            -
 *   raise blocker          y      y       y            -
 *   resolve blocker        -      y       -            -
 *   add feedback           -      y       -            -
 *
 * "no membership" = an authenticated-but-unassigned demo identity: read-only.
 * Later phases can replace the role source without touching callers.
 */

import type { MutationType, Role } from "../shared/protocol";

export function canMutate(role: Role | null, action: MutationType): boolean {
  switch (action) {
    case "task.create":
    case "task.update":
    case "task.move":
    case "task.delete":
      return role === "intern" || role === "mentor";
    case "update.create":
    case "blocker.create":
      return role === "intern" || role === "mentor" || role === "manager";
    case "blocker.resolve":
    case "feedback.create":
      return role === "mentor";
    default:
      return false;
  }
}
