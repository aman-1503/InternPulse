/**
 * Role matrix. Deliberately tiny — not a policy engine. This is the single
 * source of truth for who may perform which realtime mutation; the DO's
 * `dispatch` never re-derives permission logic, it calls `canMutate` first.
 *
 *                          intern  mentor  manager  (no membership)
 *   read / snapshot           y      y       y            y
 *   task create/update/       y      -       -            -
 *     move/delete
 *     (intern owns day-to-day task status/movement; mentor/manager may not
 *      rewrite it — they get task.priority instead)
 *   task.priority              -      y       y            -
 *   post daily update          y      -       -            -
 *   raise blocker               y      -       -            -
 *   comment on a blocker       y      y       y            -
 *   request blocker resolution y      -       -            -
 *   resolve blocker (+note)    -      y       y            -
 *   escalate blocker           -      -       y            -
 *   feedback / task comment    y      y       y            -
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
    case "update.create":
    case "blocker.create":
    case "blocker.requestResolution":
      return role === "intern";
    case "task.priority":
      return role === "mentor" || role === "manager";
    case "blocker.comment":
    case "feedback.create":
      return role === "intern" || role === "mentor" || role === "manager";
    case "blocker.resolve":
      return role === "mentor" || role === "manager";
    case "blocker.escalate":
      return role === "manager";
    default:
      return false;
  }
}
