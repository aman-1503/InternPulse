/**
 * D1 user resolution for verified Access identities, and platform-admin
 * bootstrap. This is the "what InternPulse user are they?" layer described
 * in access-auth.ts's module comment.
 */
import type { AccessIdentity } from "./access-auth";
import { recordAudit } from "./audit";

export class IdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityConflictError";
  }
}

export type PlatformRole = "USER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export interface ProductionUser {
  id: string;
  email: string;
  displayName: string;
  accountStatus: AccountStatus;
  platformRole: PlatformRole;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  account_status: AccountStatus;
  platform_role: PlatformRole;
}

function toUser(row: UserRow): ProductionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    accountStatus: row.account_status,
    platformRole: row.platform_role,
  };
}

/**
 * Bootstrap admin mechanism: a comma-separated allowlist of emails, set via
 * the ADMIN_EMAILS var/secret. This is consulted ONLY at first-ever D1 user
 * creation for that identity — it never retroactively promotes an existing
 * user, so removing an email from the list does not by itself demote anyone
 * (use the admin API / a deliberate D1 update for that).
 */
function isBootstrapAdmin(env: Env, email: string): boolean {
  const raw = env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/**
 * Resolves (and lazily creates) the D1 user for a verified Access identity.
 * Links to a pre-existing row by email (e.g. a demo-seeded user, or a
 * membership added by email before the person ever logged in) rather than
 * creating a duplicate, the first time that identity authenticates.
 */
export async function resolveProductionUser(env: Env, identity: AccessIdentity): Promise<ProductionUser> {
  const now = Date.now();

  const bySubject = await env.DB.prepare(
    "SELECT id, email, display_name, account_status, platform_role FROM users WHERE access_subject = ?",
  )
    .bind(identity.subject)
    .first<UserRow>();
  if (bySubject) {
    await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(now, bySubject.id).run();
    return toUser(bySubject);
  }

  const byEmail = await env.DB.prepare(
    "SELECT id, email, display_name, account_status, platform_role FROM users WHERE email = ? AND access_subject IS NULL",
  )
    .bind(identity.email)
    .first<UserRow>();
  if (byEmail) {
    const displayName = identity.name?.trim() || byEmail.display_name;
    await env.DB.prepare(
      "UPDATE users SET access_subject = ?, display_name = ?, updated_at = ?, last_login_at = ? WHERE id = ?",
    )
      .bind(identity.subject, displayName, now, now, byEmail.id)
      .run();
    return toUser({ ...byEmail, display_name: displayName });
  }

  // Email already belongs to a DIFFERENT access_subject — e.g. an IdP change
  // or a same-address collision. Never silently merge or overwrite an
  // existing identity binding; this needs deliberate admin resolution.
  const emailTakenByOtherSubject = await env.DB.prepare(
    "SELECT 1 FROM users WHERE email = ? AND access_subject IS NOT NULL",
  )
    .bind(identity.email)
    .first();
  if (emailTakenByOtherSubject) {
    throw new IdentityConflictError(
      `email ${identity.email} is already linked to a different verified identity`,
    );
  }

  const id = crypto.randomUUID();
  const displayName = identity.name?.trim() || identity.email;
  const platformRole: PlatformRole = isBootstrapAdmin(env, identity.email) ? "ADMIN" : "USER";
  await env.DB.prepare(
    `INSERT INTO users
       (id, email, display_name, access_subject, account_status, platform_role, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
  )
    .bind(id, identity.email, displayName, identity.subject, platformRole, now, now, now)
    .run();

  await recordAudit(env, {
    actorUserId: id,
    action: "USER_CREATED",
    targetType: "user",
    targetId: id,
    metadata: { email: identity.email, platformRole },
  });

  return { id, email: identity.email, displayName, accountStatus: "ACTIVE", platformRole };
}

/**
 * Self-service display name update. Not identity-bearing (email/access_subject
 * stay untouched) — purely a profile cosmetic, since Access frequently doesn't
 * supply a `name` claim (e.g. plain "Sign in with Cloudflare"), which
 * otherwise leaves the user's display name defaulted to their raw email.
 */
export async function updateDisplayName(
  env: Env,
  userId: string,
  displayName: string,
): Promise<ProductionUser | null> {
  const trimmed = displayName.trim();
  if (!trimmed) return null;
  await env.DB.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?")
    .bind(trimmed.slice(0, 200), Date.now(), userId)
    .run();
  return getUserById(env, userId);
}

export async function getUserById(env: Env, userId: string): Promise<ProductionUser | null> {
  const row = await env.DB.prepare(
    "SELECT id, email, display_name, account_status, platform_role FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<UserRow>();
  return row ? toUser(row) : null;
}

export async function setAccountStatus(
  env: Env,
  targetUserId: string,
  status: AccountStatus,
  actorUserId: string,
): Promise<ProductionUser | null> {
  const before = await getUserById(env, targetUserId);
  if (!before) return null;
  await env.DB.prepare("UPDATE users SET account_status = ?, updated_at = ? WHERE id = ?")
    .bind(status, Date.now(), targetUserId)
    .run();
  await recordAudit(env, {
    actorUserId,
    action: status === "ACTIVE" ? "USER_REACTIVATED" : "USER_SUSPENDED",
    targetType: "user",
    targetId: targetUserId,
    metadata: { from: before.accountStatus, to: status },
  });
  return { ...before, accountStatus: status };
}
