-- DEV / DEMO ONLY. Not a migration — never run in production.
-- Apply locally:  npm run db:seed:local     (remote: npm run db:seed:remote)
--
-- Organization metadata for the demo story — three interns across four
-- workspaces, with different mentors and a mix of shared/distinct managers
-- so multi-user, multi-workspace behavior (isolation, portfolio rollups,
-- role-differentiated homes) can be exercised concurrently:
--   Alice Chen  — intern, mentor Mia Rivera,    manager Jordan Park
--   Rahul Mehta — intern, mentor Devon Okafor,  manager Jordan Park
--   Sarah Lee   — intern, mentor Mia Rivera,    manager Priya Nair
--
-- Workspace-local content (tasks/blockers/updates/feedback/attachments) is NOT
-- here — it lives in each workspace Durable Object. Populate it with:
--   npm run demo:seed        (after `npm run dev` is running)

INSERT OR IGNORE INTO users (id, email, display_name) VALUES
  ('u-alice',  'alice@internpulse.dev',  'Alice Chen'),
  ('u-mia',    'mia@internpulse.dev',    'Mia Rivera'),
  ('u-jordan', 'jordan@internpulse.dev', 'Jordan Park'),
  ('u-rahul',  'rahul@internpulse.dev',  'Rahul Mehta'),
  ('u-devon',  'devon@internpulse.dev',  'Devon Okafor'),
  ('u-sarah',  'sarah@internpulse.dev',  'Sarah Lee'),
  ('u-priya',  'priya@internpulse.dev',  'Priya Nair');

INSERT OR IGNORE INTO workspaces (id, name, slug) VALUES
  ('demo',       'Authentication / Worker Integration', 'demo'),
  ('payments',   'Payments Service Revamp',              'payments'),
  ('rahul-ml',   'ML Pipeline Modernization',            'rahul-ml'),
  ('sarah-infra','Infra Migration to Workers',           'sarah-infra');

INSERT OR IGNORE INTO memberships (id, workspace_id, user_id, role) VALUES
  ('mb-demo-alice',      'demo',        'u-alice',  'intern'),
  ('mb-demo-mia',        'demo',        'u-mia',    'mentor'),
  ('mb-demo-jordan',     'demo',        'u-jordan', 'manager'),
  ('mb-payments-alice',  'payments',    'u-alice',  'intern'),
  ('mb-payments-mia',    'payments',    'u-mia',    'mentor'),
  ('mb-payments-jordan', 'payments',    'u-jordan', 'manager'),
  ('mb-rahul-rahul',     'rahul-ml',    'u-rahul',  'intern'),
  ('mb-rahul-devon',     'rahul-ml',    'u-devon',  'mentor'),
  ('mb-rahul-jordan',    'rahul-ml',    'u-jordan', 'manager'),
  ('mb-sarah-sarah',     'sarah-infra', 'u-sarah',  'intern'),
  ('mb-sarah-mia',       'sarah-infra', 'u-mia',    'mentor'),
  ('mb-sarah-priya',     'sarah-infra', 'u-priya',  'manager');
