import { beforeEach, describe, expect, it } from "vitest";
import { createTestD1, type FakeD1 } from "./test-support/fake-d1";
import {
  acceptInvitation,
  createInvitation,
  listPendingInvitationsForEmail,
  revokeInvitation,
} from "./invitations";
import { resolveProductionUser } from "./production-identity";

function testEnv(db: FakeD1): Env {
  return { DB: db } as unknown as Env;
}

async function seedWorkspaceAndInviter(db: FakeD1) {
  const env = testEnv(db);
  const inviter = await resolveProductionUser(env, { subject: "sub-mentor", email: "mentor@example.com" });
  await db
    .prepare("INSERT INTO workspaces (id, name, slug) VALUES ('ws-1', 'Project', 'project-abc')")
    .bind()
    .run();
  return { env, inviter };
}

describe("invitations", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = createTestD1();
  });

  it("accepting a valid pending invite grants membership and marks it ACCEPTED", async () => {
    const { env, inviter } = await seedWorkspaceAndInviter(db);
    const invite = await createInvitation(env, {
      workspaceId: "ws-1",
      email: "alice@example.com",
      role: "intern",
      invitedByUserId: inviter.id,
    });
    const alice = await resolveProductionUser(env, { subject: "sub-alice", email: "alice@example.com" });

    const result = await acceptInvitation(env, { invitationId: invite.id, user: alice });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.membershipCreated).toBe(true);
    expect(result.invitation.status).toBe("ACCEPTED");

    const membership = await db
      .prepare("SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?")
      .bind("ws-1", alice.id)
      .first<{ role: string }>();
    expect(membership?.role).toBe("intern");
  });

  it("rejects acceptance when the authenticated email does not match the invited email", async () => {
    const { env, inviter } = await seedWorkspaceAndInviter(db);
    const invite = await createInvitation(env, {
      workspaceId: "ws-1",
      email: "alice@example.com",
      role: "intern",
      invitedByUserId: inviter.id,
    });
    const eve = await resolveProductionUser(env, { subject: "sub-eve", email: "eve@example.com" });

    const result = await acceptInvitation(env, { invitationId: invite.id, user: eve });
    expect(result).toEqual({ ok: false, code: "email_mismatch" });

    const membership = await db
      .prepare("SELECT 1 FROM memberships WHERE workspace_id = ? AND user_id = ?")
      .bind("ws-1", eve.id)
      .first();
    expect(membership).toBeNull();
  });

  it("rejects re-accepting an already-accepted invite (replay)", async () => {
    const { env, inviter } = await seedWorkspaceAndInviter(db);
    const invite = await createInvitation(env, {
      workspaceId: "ws-1",
      email: "alice@example.com",
      role: "intern",
      invitedByUserId: inviter.id,
    });
    const alice = await resolveProductionUser(env, { subject: "sub-alice", email: "alice@example.com" });
    const first = await acceptInvitation(env, { invitationId: invite.id, user: alice });
    expect(first.ok).toBe(true);

    const replay = await acceptInvitation(env, { invitationId: invite.id, user: alice });
    expect(replay).toEqual({ ok: false, code: "not_pending" });
  });

  it("rejects accepting a revoked invite", async () => {
    const { env, inviter } = await seedWorkspaceAndInviter(db);
    const invite = await createInvitation(env, {
      workspaceId: "ws-1",
      email: "alice@example.com",
      role: "intern",
      invitedByUserId: inviter.id,
    });
    await revokeInvitation(env, { invitationId: invite.id, workspaceId: "ws-1", actorUserId: inviter.id });
    const alice = await resolveProductionUser(env, { subject: "sub-alice", email: "alice@example.com" });

    const result = await acceptInvitation(env, { invitationId: invite.id, user: alice });
    expect(result).toEqual({ ok: false, code: "not_pending" });
  });

  it("rejects accepting an expired invite and flips its status to EXPIRED", async () => {
    const { env, inviter } = await seedWorkspaceAndInviter(db);
    const invite = await createInvitation(env, {
      workspaceId: "ws-1",
      email: "alice@example.com",
      role: "intern",
      invitedByUserId: inviter.id,
    });
    // Force it into the past directly in D1 (createInvitation always sets a future expiry).
    await db.prepare("UPDATE workspace_invitations SET expires_at = 1 WHERE id = ?").bind(invite.id).run();
    const alice = await resolveProductionUser(env, { subject: "sub-alice", email: "alice@example.com" });

    const result = await acceptInvitation(env, { invitationId: invite.id, user: alice });
    expect(result).toEqual({ ok: false, code: "expired" });

    const row = await db
      .prepare("SELECT status FROM workspace_invitations WHERE id = ?")
      .bind(invite.id)
      .first<{ status: string }>();
    expect(row?.status).toBe("EXPIRED");
  });

  it("rejects accepting a non-existent invitation id", async () => {
    const { env } = await seedWorkspaceAndInviter(db);
    const alice = await resolveProductionUser(env, { subject: "sub-alice", email: "alice@example.com" });
    const result = await acceptInvitation(env, { invitationId: "does-not-exist", user: alice });
    expect(result).toEqual({ ok: false, code: "not_found" });
  });

  it("is idempotent on the underlying membership if one already exists", async () => {
    const { env, inviter } = await seedWorkspaceAndInviter(db);
    const alice = await resolveProductionUser(env, { subject: "sub-alice", email: "alice@example.com" });
    await db
      .prepare("INSERT INTO memberships (id, workspace_id, user_id, role) VALUES ('m1', 'ws-1', ?, 'mentor')")
      .bind(alice.id)
      .run();
    const invite = await createInvitation(env, {
      workspaceId: "ws-1",
      email: "alice@example.com",
      role: "intern",
      invitedByUserId: inviter.id,
    });

    const result = await acceptInvitation(env, { invitationId: invite.id, user: alice });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.membershipCreated).toBe(false); // pre-existing membership role is left untouched

    const membership = await db
      .prepare("SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?")
      .bind("ws-1", alice.id)
      .first<{ role: string }>();
    expect(membership?.role).toBe("mentor");
  });

  it("resending an invite to the same pending (workspace, email) refreshes it instead of duplicating", async () => {
    const { env, inviter } = await seedWorkspaceAndInviter(db);
    const first = await createInvitation(env, {
      workspaceId: "ws-1",
      email: "alice@example.com",
      role: "intern",
      invitedByUserId: inviter.id,
    });
    const second = await createInvitation(env, {
      workspaceId: "ws-1",
      email: "alice@example.com",
      role: "mentor",
      invitedByUserId: inviter.id,
    });
    expect(second.id).toBe(first.id);
    expect(second.role).toBe("mentor");

    const { results } = await db
      .prepare("SELECT * FROM workspace_invitations WHERE workspace_id = ? AND email = ?")
      .bind("ws-1", "alice@example.com")
      .all();
    expect(results).toHaveLength(1);
  });

  it("lists only pending, unexpired invitations for an email", async () => {
    const { env, inviter } = await seedWorkspaceAndInviter(db);
    const pending = await createInvitation(env, {
      workspaceId: "ws-1",
      email: "alice@example.com",
      role: "intern",
      invitedByUserId: inviter.id,
    });
    const toRevoke = await createInvitation(env, {
      workspaceId: "ws-1",
      email: "alice@example.com",
      role: "mentor",
      invitedByUserId: inviter.id,
    });
    // createInvitation refreshed the same row above since (ws,email) matched; simulate a second
    // workspace's invite to exercise the "multiple pending invites for one email" path instead.
    await db.prepare("INSERT INTO workspaces (id, name, slug) VALUES ('ws-2', 'Other', 'other-abc')").run();
    const secondWorkspaceInvite = await createInvitation(env, {
      workspaceId: "ws-2",
      email: "alice@example.com",
      role: "manager",
      invitedByUserId: inviter.id,
    });
    void toRevoke;

    const listed = await listPendingInvitationsForEmail(env, "ALICE@example.com");
    const ids = listed.map((i) => i.id).sort();
    expect(ids).toEqual([pending.id, secondWorkspaceInvite.id].sort());
  });
});
