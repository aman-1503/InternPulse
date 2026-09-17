import { beforeEach, describe, expect, it } from "vitest";
import { createTestD1, type FakeD1 } from "./test-support/fake-d1";
import { IdentityConflictError, getUserById, resolveProductionUser, setAccountStatus } from "./production-identity";
import type { AccessIdentity } from "./access-auth";

function testEnv(db: FakeD1, adminEmails = ""): Env {
  return { DB: db, ADMIN_EMAILS: adminEmails } as unknown as Env;
}

const ALICE: AccessIdentity = { subject: "sub-alice", email: "alice@example.com", name: "Alice Intern" };

describe("resolveProductionUser", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = createTestD1();
  });

  it("creates a new user on first login as platform_role USER by default", async () => {
    const user = await resolveProductionUser(testEnv(db), ALICE);
    expect(user.email).toBe("alice@example.com");
    expect(user.platformRole).toBe("USER");
    expect(user.accountStatus).toBe("ACTIVE");
  });

  it("grants ADMIN only on first creation when the email is in ADMIN_EMAILS", async () => {
    const env = testEnv(db, "Alice@Example.com, other@example.com");
    const user = await resolveProductionUser(env, ALICE);
    expect(user.platformRole).toBe("ADMIN");
  });

  it("does not retroactively promote an existing user added to ADMIN_EMAILS later", async () => {
    const created = await resolveProductionUser(testEnv(db, ""), ALICE);
    expect(created.platformRole).toBe("USER");
    // Same subject logs in again after an admin later adds their email to the allowlist.
    const again = await resolveProductionUser(testEnv(db, "alice@example.com"), ALICE);
    expect(again.platformRole).toBe("USER");
  });

  it("is idempotent by access_subject across repeated logins", async () => {
    const first = await resolveProductionUser(testEnv(db), ALICE);
    const second = await resolveProductionUser(testEnv(db), ALICE);
    expect(second.id).toBe(first.id);
  });

  it("links a pre-existing (e.g. invited/seeded) user row by email instead of duplicating it", async () => {
    await db
      .prepare(
        "INSERT INTO users (id, email, display_name, account_status, platform_role, created_at, updated_at) VALUES ('preexisting', 'alice@example.com', 'Placeholder Name', 'ACTIVE', 'USER', 0, 0)",
      )
      .bind()
      .run();
    const user = await resolveProductionUser(testEnv(db), ALICE);
    expect(user.id).toBe("preexisting");
    expect(user.displayName).toBe("Alice Intern");
  });

  it("never links to a row that already has a DIFFERENT access_subject", async () => {
    await resolveProductionUser(testEnv(db), { subject: "sub-bob", email: "bob@example.com" });
    await expect(
      resolveProductionUser(testEnv(db), { subject: "sub-attacker", email: "bob@example.com" }),
    ).rejects.toThrow(IdentityConflictError);
  });
});

describe("account status", () => {
  let db: FakeD1;

  beforeEach(() => {
    db = createTestD1();
  });

  it("suspend then reactivate round-trips and is reflected on next resolve", async () => {
    const env = testEnv(db);
    const user = await resolveProductionUser(env, ALICE);
    const suspended = await setAccountStatus(env, user.id, "SUSPENDED", "admin-1");
    expect(suspended?.accountStatus).toBe("SUSPENDED");
    const reResolved = await resolveProductionUser(env, ALICE);
    expect(reResolved.accountStatus).toBe("SUSPENDED");

    const reactivated = await setAccountStatus(env, user.id, "ACTIVE", "admin-1");
    expect(reactivated?.accountStatus).toBe("ACTIVE");
    expect((await getUserById(env, user.id))?.accountStatus).toBe("ACTIVE");
  });

  it("returns null for a non-existent user", async () => {
    const env = testEnv(db);
    expect(await setAccountStatus(env, "does-not-exist", "SUSPENDED", "admin-1")).toBeNull();
  });
});
