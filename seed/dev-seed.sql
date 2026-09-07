-- DEV / DEMO ONLY. Not a migration — never run in production.
-- Apply locally:  npm run db:seed:local     (remote: npm run db:seed:remote)
--
-- Organization metadata for the demo story:
--   Alice Chen  — intern
--   Mia Rivera  — mentor
--   Jordan Park — manager
-- on the "Authentication / Worker Integration" project (+ a second project so the
-- manager overview has more than one row).
--
-- Workspace-local content (tasks/blockers/updates/feedback/attachments) is NOT
-- here — it lives in each workspace Durable Object. Populate it with:
--   npm run demo:seed        (after `npm run dev` is running)

INSERT OR IGNORE INTO users (id, email, display_name) VALUES
  ('u-alice',  'alice@internpulse.dev',  'Alice Chen'),
  ('u-mia',    'mia@internpulse.dev',    'Mia Rivera'),
  ('u-jordan', 'jordan@internpulse.dev', 'Jordan Park');

INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES
  ('demo',     'Authentication / Worker Integration', 'demo'),
  ('payments', 'Payments Service Revamp',             'payments');

INSERT OR IGNORE INTO memberships (id, workspace_id, user_id, role) VALUES
  ('mb-demo-alice',      'demo',     'u-alice',  'intern'),
  ('mb-demo-mia',        'demo',     'u-mia',    'mentor'),
  ('mb-demo-jordan',     'demo',     'u-jordan', 'manager'),
  ('mb-payments-alice',  'payments', 'u-alice',  'intern'),
  ('mb-payments-mia',    'payments', 'u-mia',    'mentor'),
  ('mb-payments-jordan', 'payments', 'u-jordan', 'manager');
