-- InternPulse D1 — organization-wide relational data (Phase 1).
--
-- D1 is the source of truth for identity and org structure ONLY.
-- Workspace activity (updates, tasks, blockers, comments, feedback, ...) lives
-- in each workspace's Durable Object SQLite storage, never here. Do not
-- duplicate business entities across the two stores.

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Org-level groupings of people. Not workspace-scoped in Phase 1.
CREATE TABLE teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE team_memberships (
  team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (team_id, user_id)
);

-- One workspace == one internship/project == one Durable Object.
CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- A user's role within a workspace. Authorization (Phase 2+) reads
-- (workspace_id, user_id) -> role from this table.
CREATE TABLE memberships (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('intern', 'mentor', 'manager')),
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX idx_memberships_workspace ON memberships (workspace_id);
CREATE INDEX idx_memberships_user ON memberships (user_id);
CREATE INDEX idx_team_memberships_user ON team_memberships (user_id);
