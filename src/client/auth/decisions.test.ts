import { describe, expect, it } from "vitest";
import { deriveHomeRole, deriveOnboardingStage } from "./decisions";
import type { Membership, PendingInvitation } from "./types";

function membership(role: Membership["role"], workspaceId = "ws-1"): Membership {
  return { workspaceId, workspaceName: "W", slug: "w", role };
}

function invitation(): PendingInvitation {
  return {
    id: "inv-1",
    workspaceId: "ws-1",
    workspaceName: "W",
    email: "a@example.com",
    role: "intern",
    invitedByUserId: "u1",
    invitedByName: "Someone",
    status: "PENDING",
    createdAt: 0,
    expiresAt: 0,
    acceptedAt: null,
  };
}

describe("deriveOnboardingStage", () => {
  it("goes to home when any membership exists, even alongside pending invitations", () => {
    expect(deriveOnboardingStage({ memberships: [membership("intern")], pendingInvitations: [invitation()] })).toBe("home");
  });

  it("goes to invitations when there are no memberships but a pending invite exists", () => {
    expect(deriveOnboardingStage({ memberships: [], pendingInvitations: [invitation()] })).toBe("invitations");
  });

  it("goes to onboarding when there is neither a membership nor an invitation", () => {
    expect(deriveOnboardingStage({ memberships: [], pendingInvitations: [] })).toBe("onboarding");
  });
});

describe("deriveHomeRole", () => {
  it("prefers manager over mentor and intern", () => {
    expect(deriveHomeRole([membership("intern"), membership("mentor"), membership("manager")])).toBe("manager");
  });

  it("prefers mentor over intern when there is no manager membership", () => {
    expect(deriveHomeRole([membership("intern"), membership("mentor")])).toBe("mentor");
  });

  it("falls back to intern when that's the only role held", () => {
    expect(deriveHomeRole([membership("intern")])).toBe("intern");
  });

  it("returns null with no memberships at all", () => {
    expect(deriveHomeRole([])).toBeNull();
  });
});
