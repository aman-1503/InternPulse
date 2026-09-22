import { beforeEach, describe, expect, it } from "vitest";
import { createTestD1, type FakeD1 } from "./test-support/fake-d1";
import { handleAdminRoute } from "./admin-routes";
import { resolveProductionUser, type ProductionUser } from "./production-identity";

function testEnv(db: FakeD1): Env {
  return { DB: db } as unknown as Env;
}

function req(method: string, body?: unknown): Request {
  return new Request("https://internal/api/admin", {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}

async function seed(db: FakeD1) {
  const env = testEnv(db);
  const admin = await resolveProductionUser(env, { subject: "sub-admin", email: "admin@example.com" });
  const manager = await resolveProductionUser(env, { subject: "sub-mgr", email: "mgr@example.com" });
  const intern = await resolveProductionUser(env, { subject: "sub-intern", email: "intern@example.com" });
  await db.prepare("INSERT INTO workspaces (id, name, slug) VALUES ('ws-1', 'Project', 'project-abc')").run();
  await db
    .prepare("INSERT INTO memberships (id, workspace_id, user_id, role) VALUES ('m-mgr', 'ws-1', ?, 'manager')")
    .bind(manager.id)
    .run();
  await db
    .prepare("INSERT INTO memberships (id, workspace_id, user_id, role) VALUES ('m-intern', 'ws-1', ?, 'intern')")
    .bind(intern.id)
    .run();
  return { env, admin, manager, intern };
}

describe("admin routes", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = createTestD1();
  });

  it("refuses to remove the last manager of a workspace", async () => {
    const { env, admin, manager } = await seed(db);
    const res = await handleAdminRoute(
      env,
      req("DELETE"),
      new URL("https://internal/api/admin/workspaces/ws-1/members/" + manager.id),
      ["workspaces", "ws-1", "members", manager.id],
      admin,
    );
    expect(res.status).toBe(409);
    const membership = await db
      .prepare("SELECT 1 FROM memberships WHERE workspace_id='ws-1' AND user_id=?")
      .bind(manager.id)
      .first();
    expect(membership).not.toBeNull();
  });

  it("allows removing a non-manager membership and records an audit event", async () => {
    const { env, admin, intern } = await seed(db);
    const res = await handleAdminRoute(
      env,
      req("DELETE"),
      new URL("https://internal/api/admin/workspaces/ws-1/members/" + intern.id),
      ["workspaces", "ws-1", "members", intern.id],
      admin,
    );
    expect(res.status).toBe(200);
    const membership = await db
      .prepare("SELECT 1 FROM memberships WHERE workspace_id='ws-1' AND user_id=?")
      .bind(intern.id)
      .first();
    expect(membership).toBeNull();

    const audit = await db
      .prepare("SELECT action FROM audit_events WHERE target_id = ? AND action = 'MEMBERSHIP_REMOVED'")
      .bind(intern.id)
      .first<{ action: string }>();
    expect(audit?.action).toBe("MEMBERSHIP_REMOVED");
  });

  it("repairs (adds) a membership and audits it", async () => {
    const { env, admin, intern } = await seed(db);
    await db.prepare("INSERT INTO workspaces (id, name, slug) VALUES ('ws-2', 'Other', 'other-abc')").run();
    const res = await handleAdminRoute(
      env,
      req("POST", { userId: intern.id, role: "mentor" }),
      new URL("https://internal/api/admin/workspaces/ws-2/members"),
      ["workspaces", "ws-2", "members"],
      admin,
    );
    expect(res.status).toBe(200);
    const membership = await db
      .prepare("SELECT role FROM memberships WHERE workspace_id='ws-2' AND user_id=?")
      .bind(intern.id)
      .first<{ role: string }>();
    expect(membership?.role).toBe("mentor");
  });

  it("suspending a user is reflected via resolveProductionUser on their next request", async () => {
    const { env, admin, intern } = await seed(db);
    const res = await handleAdminRoute(
      env,
      req("POST"),
      new URL(`https://internal/api/admin/users/${intern.id}/suspend`),
      ["users", intern.id, "suspend"],
      admin,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: ProductionUser };
    expect(body.user.accountStatus).toBe("SUSPENDED");
  });

  it("refuses to let an admin suspend themself", async () => {
    const { env, admin } = await seed(db);
    const res = await handleAdminRoute(
      env,
      req("POST"),
      new URL(`https://internal/api/admin/users/${admin.id}/suspend`),
      ["users", admin.id, "suspend"],
      admin,
    );
    expect(res.status).toBe(400);
  });

  it("404s on an unknown admin resource", async () => {
    const { env, admin } = await seed(db);
    const res = await handleAdminRoute(env, req("GET"), new URL("https://internal/api/admin/bogus"), ["bogus"], admin);
    expect(res.status).toBe(404);
  });
});
