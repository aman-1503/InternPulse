-- DEV / DEMO ONLY. This is NOT a migration and must never run in production.
-- Apply locally with:  npm run db:seed:local
--
-- Provides three identities and two workspaces so the role-aware UI and the
-- manager overview have something to show. The browser "identity switcher"
-- (DEV ONLY) sets localStorage to one of these user ids so D1 membership
-- resolves a real role.

INSERT OR IGNORE INTO users (id, email, display_name) VALUES
  ('u-alice', 'alice@example.com', 'Alice (Intern)'),
  ('u-mia',   'mia@example.com',   'Mia (Mentor)'),
  ('u-max',   'max@example.com',   'Max (Manager)');

INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES
  ('demo',     'Demo Internship', 'demo'),
  ('payments', 'Payments Revamp', 'payments');

INSERT OR IGNORE INTO memberships (id, workspace_id, user_id, role) VALUES
  ('mb-demo-alice',     'demo',     'u-alice', 'intern'),
  ('mb-demo-mia',       'demo',     'u-mia',   'mentor'),
  ('mb-demo-max',       'demo',     'u-max',   'manager'),
  ('mb-payments-alice', 'payments', 'u-alice', 'intern'),
  ('mb-payments-mia',   'payments', 'u-mia',   'mentor'),
  ('mb-payments-max',   'payments', 'u-max',   'manager');
