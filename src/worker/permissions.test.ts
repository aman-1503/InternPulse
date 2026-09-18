import { describe, expect, it } from "vitest";
import { canMutate } from "./permissions";
import type { MutationType, Role } from "../shared/protocol";

const ROLES: Array<Role | null> = ["intern", "mentor", "manager", null];

const EXPECTED: Record<MutationType, Role[]> = {
  "task.create": ["intern"],
  "task.update": ["intern"],
  "task.move": ["intern"],
  "task.delete": ["intern"],
  "task.priority": ["mentor", "manager"],
  "blocker.create": ["intern"],
  "blocker.comment": ["intern", "mentor", "manager"],
  "blocker.requestResolution": ["intern"],
  "blocker.resolve": ["mentor", "manager"],
  "blocker.escalate": ["manager"],
  "update.create": ["intern"],
  "feedback.create": ["mentor", "manager"],
};

describe("permission matrix (locked-spec compliance)", () => {
  for (const [action, allowedRoles] of Object.entries(EXPECTED) as Array<[MutationType, Role[]]>) {
    for (const role of ROLES) {
      const expected = role !== null && allowedRoles.includes(role);
      it(`${action}: role=${role ?? "none"} -> ${expected ? "allowed" : "denied"}`, () => {
        expect(canMutate(role, action)).toBe(expected);
      });
    }
  }

  it("mentor cannot move or rewrite intern task status (the locked-spec bug this pass fixes)", () => {
    expect(canMutate("mentor", "task.update")).toBe(false);
    expect(canMutate("mentor", "task.move")).toBe(false);
    expect(canMutate("mentor", "task.delete")).toBe(false);
  });

  it("manager cannot rewrite task state either, only priority/comment/resolve/escalate", () => {
    expect(canMutate("manager", "task.update")).toBe(false);
    expect(canMutate("manager", "task.priority")).toBe(true);
    expect(canMutate("manager", "blocker.resolve")).toBe(true);
    expect(canMutate("manager", "blocker.escalate")).toBe(true);
  });

  it("final blocker resolution is confirmable only by mentor or manager, never intern", () => {
    expect(canMutate("intern", "blocker.resolve")).toBe(false);
  });

  it("an intern cannot give feedback (feedback flows mentor/manager -> intern only)", () => {
    expect(canMutate("intern", "feedback.create")).toBe(false);
    expect(canMutate("mentor", "feedback.create")).toBe(true);
    expect(canMutate("manager", "feedback.create")).toBe(true);
  });
});
