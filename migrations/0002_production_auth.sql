-- Production authentication: Cloudflare Access identity, invitations, admin,
-- and audit logging. See README "Cloudflare Access setup" for the identity
-- model this supports.
--
-- Cloudflare Access answers "who is this authenticated person?" (access_subject
-- / email). D1 still answers "what InternPulse user/role/workspace access do
-- they have?" via `users` + `memberships` (unchanged). Nothing here duplicates
-- workspace-local state, which stays in each Workspace Durable Object.

-- access_subject: the Access JWT `sub` claim (stable per identity/IdP). NULL
-- for users that only exist via demo seed data and have never logged in
-- through Access yet — resolveProductionUser() links such a row by email on
-- first real login instead of creating a duplicate user.
ALTER TABLE users ADD COLUMN access_subject TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN job_title TEXT;
ALTER TABLE users ADD COLUMN timezone TEXT;
ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'DISABLED'));
ALTER TABLE users ADD COLUMN platform_role TEXT NOT NULL DEFAULT 'USER'
  CHECK (platform_role IN ('USER', 'ADMIN'));
ALTER TABLE users ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at INTEGER;

CREATE UNIQUE INDEX idx_users_access_subject ON users (access_subject)
  WHERE access_subject IS NOT NULL;

-- Demo workspaces are seeded, unauthenticated-by-design sample data reachable
-- only via /api/demo/*. Production routes refuse to serve a demo workspace
-- and demo routes refuse to serve a non-demo (real) workspace.
ALTER TABLE workspaces ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN team TEXT;
ALTER TABLE workspaces ADD COLUMN start_date TEXT;
ALTER TABLE workspaces ADD COLUMN end_date TEXT;

-- Pending/actioned invites for people who may not have an InternPulse account
-- yet. Acceptance requires the authenticated Access email to match `email`
-- exactly (case-insensitive) — see acceptInvitation() in src/worker/invitations.ts.
CREATE TABLE workspace_invitations (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email              TEXT NOT NULL,
  role               TEXT NOT NULL CHECK (role IN ('intern', 'mentor', 'manager')),
  invited_by_user_id TEXT NOT NULL REFERENCES users(id),
  status             TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  created_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  expires_at         INTEGER NOT NULL,
  accepted_at        INTEGER
);

CREATE INDEX idx_invitations_workspace ON workspace_invitations (workspace_id);
CREATE INDEX idx_invitations_email_status ON workspace_invitations (email, status);

-- Security-sensitive admin/account/membership/invitation events. Bounded,
-- append-only. Never stores JWTs or other secrets — see recordAudit().
CREATE TABLE audit_events (
  id             TEXT PRIMARY KEY,
  actor_user_id  TEXT REFERENCES users(id),
  action         TEXT NOT NULL,
  target_type    TEXT,
  target_id      TEXT,
  workspace_id   TEXT,
  metadata_json  TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_audit_actor ON audit_events (actor_user_id);
CREATE INDEX idx_audit_workspace ON audit_events (workspace_id);
CREATE INDEX idx_audit_created ON audit_events (created_at);
