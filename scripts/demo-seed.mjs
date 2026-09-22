/**
 * DEV / DEMO ONLY — populates workspace Durable Objects with coherent stories
 * for the three demo interns (see seed/dev-seed.sql):
 *   demo         Alice Chen  / mentor Mia Rivera   / manager Jordan Park
 *   rahul-ml     Rahul Mehta / mentor Devon Okafor / manager Jordan Park
 *   sarah-infra  Sarah Lee   / mentor Mia Rivera   / manager Priya Nair
 *
 *   Run `npm run dev` first, then:  npm run demo:seed
 *   Override target:  INTERNPULSE_URL=http://127.0.0.1:8788 npm run demo:seed
 *   Re-seed anyway:   npm run demo:seed -- --force
 *   Seed one workspace only: INTERNPULSE_WORKSPACE=rahul-ml npm run demo:seed
 *
 * Idempotent per workspace: skips a workspace that already has tasks (unless --force).
 */

const BASE = process.env.INTERNPULSE_URL || "http://127.0.0.1:5173";
const WS_BASE = BASE.replace(/^http/, "ws");
const ONLY_WORKSPACE = process.env.INTERNPULSE_WORKSPACE || null;
const FORCE = process.argv.includes("--force");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => crypto.randomUUID();
const daysFromNow = (n) => Date.now() + n * 86_400_000;

function connect(workspace, userId, displayName, devRole) {
  return new Promise((resolve, reject) => {
    const url = `${WS_BASE}/api/demo/workspace/${workspace}/ws?userId=${userId}&displayName=${encodeURIComponent(
      displayName,
    )}&devRole=${devRole}`;
    const ws = new WebSocket(url);
    ws.inbox = [];
    ws.addEventListener("message", (e) => ws.inbox.push(JSON.parse(e.data)));
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", reject);
    setTimeout(() => reject(new Error("WS connect timeout — is `npm run dev` running?")), 8000);
  });
}
const last = (ws, type) => [...ws.inbox].reverse().find((m) => m.type === type);
const send = (ws, msg) => ws.send(JSON.stringify({ requestId: rid(), ...msg }));

async function weeklyHttp(workspace, path, who, init = {}) {
  const qs = `userId=${who.id}&displayName=${encodeURIComponent(who.name)}&devRole=${who.role}`;
  const res = await fetch(`${BASE}/api/demo/workspace/${workspace}/weekly${path}?${qs}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  return res.json();
}

async function seedWorkspace(cfg) {
  console.log(`\n== ${cfg.workspace} (${cfg.intern.name} / ${cfg.mentor.name} / ${cfg.manager.name}) ==`);
  const intern = await connect(cfg.workspace, cfg.intern.id, cfg.intern.name, "intern");
  const mentor = await connect(cfg.workspace, cfg.mentor.id, cfg.mentor.name, "mentor");
  const manager = await connect(cfg.workspace, cfg.manager.id, cfg.manager.name, "manager");
  await wait(400);

  const snap = last(intern, "workspace.snapshot");
  if (snap && snap.tasks.length > 0 && !FORCE) {
    console.log(`  already has ${snap.tasks.length} tasks — skipping (use --force to re-seed)`);
    intern.close();
    mentor.close();
    manager.close();
    return;
  }

  for (const t of cfg.tasks) {
    send(intern, { type: "task.create", ...t });
    await wait(120);
  }
  console.log(`  ${cfg.tasks.length} tasks (incl. ${cfg.tasks.filter((t) => t.priority === "URGENT").length} URGENT)`);

  // Historical resolved blocker, with a discussion thread + resolution note.
  send(intern, { type: "blocker.create", description: cfg.resolvedBlocker });
  await wait(300);
  const oldBlockerId = last(intern, "blocker.created")?.blocker.id;
  send(mentor, { type: "blocker.comment", id: oldBlockerId, content: "Looking into this now." });
  await wait(200);
  send(intern, { type: "blocker.requestResolution", id: oldBlockerId });
  await wait(200);
  send(mentor, { type: "blocker.resolve", id: oldBlockerId, note: "Confirmed fixed after your last update." });
  await wait(300);
  console.log("  1 resolved blocker (with discussion + resolution note)");

  // Current open blocker — mentor has not responded yet (exercises the attention engine).
  send(intern, { type: "blocker.create", description: cfg.openBlocker, taskId: null });
  await wait(300);
  console.log("  1 open blocker (awaiting mentor response)");

  for (const content of cfg.updates) {
    send(intern, { type: "update.create", content, updateType: "DAILY" });
    await wait(120);
  }
  console.log(`  ${cfg.updates.length} daily updates (incl. an @mention)`);

  for (const content of cfg.feedback) {
    send(mentor, { type: "feedback.create", content });
    await wait(120);
  }
  console.log(`  ${cfg.feedback.length} mentor feedback item(s)`);

  await wait(400);
  intern.close();
  mentor.close();
  manager.close();

  // Weekly review, driven to the lifecycle stage the config asks for.
  if (cfg.weekly) {
    const { report } = await weeklyHttp(cfg.workspace, "", cfg.intern, { method: "POST", body: "{}" });
    await weeklyHttp(cfg.workspace, `/${report.id}`, cfg.intern, {
      method: "PATCH",
      body: JSON.stringify({ draftContent: cfg.weekly.draft }),
    });
    await weeklyHttp(cfg.workspace, `/${report.id}/submit`, cfg.intern, { method: "POST" });
    await wait(500);

    if (cfg.weekly.outcome === "CHANGES_REQUESTED") {
      await weeklyHttp(cfg.workspace, `/${report.id}/review`, cfg.mentor, {
        method: "POST",
        body: JSON.stringify({ decision: "REQUEST_CHANGES", feedback: "Add more detail on testing coverage." }),
      });
      console.log(`  1 weekly report -> CHANGES_REQUESTED`);
    } else if (cfg.weekly.outcome === "RESUBMITTED") {
      await weeklyHttp(cfg.workspace, `/${report.id}/review`, cfg.mentor, {
        method: "POST",
        body: JSON.stringify({ decision: "REQUEST_CHANGES", feedback: "One more pass on the risks section." }),
      });
      await wait(500);
      await weeklyHttp(cfg.workspace, `/${report.id}/submit`, cfg.intern, { method: "POST" });
      console.log(`  1 weekly report -> RESUBMITTED`);
    } else if (cfg.weekly.outcome === "APPROVED_BY_OVERRIDE") {
      await wait(300);
      await weeklyHttp(cfg.workspace, `/${report.id}/override`, cfg.manager, {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVE", note: "Mentor is OOO this week — approving on their behalf." }),
      });
      console.log(`  1 weekly report -> APPROVED (manager override)`);
    } else {
      await weeklyHttp(cfg.workspace, `/${report.id}/review`, cfg.mentor, {
        method: "POST",
        body: JSON.stringify({ decision: "APPROVE" }),
      });
      console.log(`  1 weekly report -> APPROVED`);
    }
  }
}

const WORKSPACES = [
  {
    workspace: "demo",
    intern: { id: "u-alice", name: "Alice Chen" },
    mentor: { id: "u-mia", name: "Mia Rivera" },
    manager: { id: "u-jordan", name: "Jordan Park" },
    tasks: [
      { title: "Wire the OAuth callback route in the Worker", status: "DONE", priority: "HIGH" },
      { title: "Store sessions in the workspace Durable Object", status: "IN_PROGRESS", priority: "HIGH" },
      { title: "Add refresh-token rotation with reuse detection", status: "TODO", priority: "URGENT", dueDate: daysFromNow(1) },
      { title: "Rate-limit the login endpoint (5/min/IP)", status: "TODO", priority: "MEDIUM", dueDate: daysFromNow(-2) },
      { title: "Write integration tests for the auth flow", status: "TODO", priority: null },
    ],
    resolvedBlocker:
      "Waiting on the platform team to provision a staging OAuth client before I can test the callback.",
    openBlocker:
      "PKCE code_verifier mismatch only on Safari — the challenge is being double-encoded somewhere. Need a second pair of eyes.",
    updates: [
      "Got the OAuth callback route working end to end against the staging client. Sessions now persist in the DO.",
      "Started refresh-token rotation. Access tokens are 10 min; rotation writes a new family id and revokes the old one on reuse.",
      "@Mia Rivera blocked on a Safari-only PKCE verifier mismatch. Everything passes on Chrome/Firefox. Digging into how the verifier is stored.",
    ],
    feedback: [
      "Nice work getting the callback solid. Before the PR: add explicit handling for an expired/replayed refresh token, and a test for it.",
      "For the Safari issue — check whether the verifier is being base64url-encoded twice. Compare the bytes you store vs the bytes you send.",
    ],
    weekly: { draft: "Shipped the OAuth callback + session storage. Working through refresh rotation next.", outcome: "CHANGES_REQUESTED" },
    document: {
      filename: "auth-design-notes.md",
      content: `# Authentication / Worker Integration — Design Notes

## Goal
Add OAuth 2.0 (authorization code + PKCE) login to the Worker, with sessions in a
Durable Object and rotating refresh tokens.

## Session storage
Sessions live in the workspace Durable Object, keyed by an opaque session id set
in an HttpOnly cookie. No session state in D1.

## Refresh-token rotation
Access tokens are short-lived (10 minutes). Every refresh issues a new
refresh token and invalidates the previous one. If a already-used refresh token
is presented again (reuse detection), the entire token family is revoked and the
user must log in again.

## Rate limiting
Login attempts are capped at 5 per minute per IP using a sliding-window counter.

## Known risks
- Token replay -> mitigated by short access tokens + refresh rotation + reuse detection.
- Open redirect on the callback -> allowlist redirect_uri values.
`,
    },
  },
  {
    workspace: "rahul-ml",
    intern: { id: "u-rahul", name: "Rahul Mehta" },
    mentor: { id: "u-devon", name: "Devon Okafor" },
    manager: { id: "u-jordan", name: "Jordan Park" },
    tasks: [
      { title: "Stand up the feature-store schema in D1", status: "DONE", priority: "MEDIUM" },
      { title: "Batch-embed historical events into Vectorize", status: "IN_PROGRESS", priority: "HIGH", dueDate: daysFromNow(3) },
      { title: "Fix training job OOM on the full dataset", status: "BLOCKED", priority: "URGENT", dueDate: daysFromNow(0) },
      { title: "Add drift-detection alert to the scoring job", status: "TODO", priority: "LOW" },
    ],
    resolvedBlocker: "GPU quota for the training job was maxed out — needed a quota bump from platform.",
    openBlocker: "Training job OOMs at ~80% through the full dataset even after reducing batch size. Suspect a memory leak in the preprocessing step.",
    updates: [
      "Feature store schema is live; backfilled the last 30 days of events.",
      "Embedding job is ~60% through the historical backfill.",
      "@Devon Okafor the OOM is blocking the URGENT training-job fix — need your input on the preprocessing pipeline.",
    ],
    feedback: [
      "Good progress on the feature store. For the OOM, try profiling with a 10% sample first before the full run.",
    ],
    weekly: { draft: "Feature store done, embedding backfill in progress, training job blocked on OOM.", outcome: "RESUBMITTED" },
  },
  {
    workspace: "sarah-infra",
    intern: { id: "u-sarah", name: "Sarah Lee" },
    mentor: { id: "u-mia", name: "Mia Rivera" },
    manager: { id: "u-priya", name: "Priya Nair" },
    tasks: [
      { title: "Migrate the legacy queue consumer to a Cloudflare Queue", status: "DONE", priority: "HIGH" },
      { title: "Cut over read traffic to the new D1 replica", status: "IN_PROGRESS", priority: "URGENT", dueDate: daysFromNow(2) },
      { title: "Decommission the old cron-based poller", status: "TODO", priority: "MEDIUM" },
      { title: "Document the new deployment runbook", status: "TODO", priority: "LOW", dueDate: daysFromNow(-1) },
    ],
    resolvedBlocker: "Needed a temporary allowlist rule to let the migration script reach the legacy DB during cutover.",
    openBlocker: "D1 replica lag spikes to 40s under load — cutting over read traffic now would serve stale data.",
    updates: [
      "Queue consumer migration is done and has been stable for 48h.",
      "Started the D1 replica cutover, currently watching replication lag.",
      "@Priya Nair flagging the replica lag issue in case we need to slip the cutover date.",
    ],
    feedback: ["The queue migration write-up was thorough — reuse that structure for the D1 cutover doc."],
    weekly: { draft: "Queue migration complete. D1 cutover blocked on replica lag investigation.", outcome: "APPROVED_BY_OVERRIDE" },
  },
];

async function main() {
  console.log(`demo-seed → ${BASE}`);
  const targets = ONLY_WORKSPACE ? WORKSPACES.filter((w) => w.workspace === ONLY_WORKSPACE) : WORKSPACES;
  for (const cfg of targets) {
    await seedWorkspace(cfg);
    if (cfg.document) {
      try {
        const form = new FormData();
        form.append("file", new File([cfg.document.content], cfg.document.filename, { type: "text/markdown" }));
        const res = await fetch(
          `${BASE}/api/demo/workspace/${cfg.workspace}/attachments?userId=${cfg.intern.id}&displayName=${encodeURIComponent(cfg.intern.name)}&devRole=intern`,
          { method: "POST", body: form },
        );
        if (res.ok) console.log(`  1 attachment (${cfg.document.filename}) — will index in ~30-60s`);
        else console.log(`  attachment upload skipped (${res.status})`);
      } catch (err) {
        console.log(`  attachment upload skipped (${err.message})`);
      }
    }
  }
  console.log("\ndemo-seed done.");
}

main().catch((err) => {
  console.error("demo-seed failed:", err.message);
  process.exit(1);
});
