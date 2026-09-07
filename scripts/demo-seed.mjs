/**
 * DEV / DEMO ONLY — populates the "demo" workspace Durable Object with a
 * coherent story: the Authentication / Worker Integration project.
 *
 *   Run `npm run dev` first, then:  npm run demo:seed
 *   Override target:  INTERNPULSE_URL=http://127.0.0.1:8788 npm run demo:seed
 *   Re-seed anyway:   npm run demo:seed -- --force
 *
 * Idempotent: skips if the workspace already has tasks (unless --force).
 */

const BASE = process.env.INTERNPULSE_URL || "http://127.0.0.1:5173";
const WS_BASE = BASE.replace(/^http/, "ws");
const WORKSPACE = process.env.INTERNPULSE_WORKSPACE || "demo";
const FORCE = process.argv.includes("--force");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => crypto.randomUUID();

function connect(userId, displayName, devRole) {
  return new Promise((resolve, reject) => {
    const url = `${WS_BASE}/api/workspace/${WORKSPACE}/ws?userId=${userId}&displayName=${encodeURIComponent(
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

async function main() {
  console.log(`demo-seed → ${BASE}  workspace="${WORKSPACE}"`);
  const alice = await connect("u-alice", "Alice Chen", "intern");
  const mia = await connect("u-mia", "Mia Rivera", "mentor");
  await wait(400);

  const snap = last(alice, "workspace.snapshot");
  if (snap && snap.tasks.length > 0 && !FORCE) {
    console.log(`Workspace already has ${snap.tasks.length} tasks — skipping. Use --force to re-seed.`);
    alice.close();
    mia.close();
    return;
  }

  // --- Tasks (Alice) ---
  const tasks = [
    ["Wire the OAuth callback route in the Worker", "DONE", "HIGH"],
    ["Store sessions in the workspace Durable Object", "IN_PROGRESS", "HIGH"],
    ["Add refresh-token rotation with reuse detection", "TODO", "HIGH"],
    ["Rate-limit the login endpoint (5/min/IP)", "TODO", "MEDIUM"],
    ["Write integration tests for the auth flow", "TODO", null],
  ];
  for (const [title, status, priority] of tasks) {
    send(alice, { type: "task.create", title, status, priority });
    await wait(150);
  }
  console.log(`  ${tasks.length} tasks`);

  // --- A historical, resolved blocker ---
  send(alice, {
    type: "blocker.create",
    description: "Waiting on the platform team to provision a staging OAuth client before I can test the callback.",
  });
  await wait(400);
  const oldBlockerId = last(alice, "blocker.created")?.blocker.id;
  send(mia, { type: "blocker.resolve", id: oldBlockerId });
  await wait(300);
  console.log("  1 resolved (historical) blocker");

  // --- A current, open blocker ---
  send(alice, {
    type: "blocker.create",
    description:
      "PKCE code_verifier mismatch only on Safari — the challenge is being double-encoded somewhere. Need a second pair of eyes.",
  });
  await wait(300);
  console.log("  1 open blocker");

  // --- Daily updates (Alice) ---
  const updates = [
    "Got the OAuth callback route working end to end against the staging client. Sessions now persist in the DO.",
    "Started refresh-token rotation. Access tokens are 10 min; rotation writes a new family id and revokes the old one on reuse.",
    "Blocked on a Safari-only PKCE verifier mismatch. Everything passes on Chrome/Firefox. Digging into how the verifier is stored.",
  ];
  for (const content of updates) {
    send(alice, { type: "update.create", content, updateType: "DAILY" });
    await wait(150);
  }
  console.log(`  ${updates.length} daily updates`);

  // --- Mentor feedback (Mia) ---
  const feedback = [
    "Nice work getting the callback solid. Before the PR: add explicit handling for an expired/replayed refresh token, and a test for it.",
    "For the Safari issue — check whether the verifier is being base64url-encoded twice. Compare the bytes you store vs the bytes you send.",
  ];
  for (const content of feedback) {
    send(mia, { type: "feedback.create", content });
    await wait(150);
  }
  console.log(`  ${feedback.length} mentor feedback`);

  await wait(600);
  alice.close();
  mia.close();

  // --- Optional: upload a project document for RAG (best-effort) ---
  const DOC = `# Authentication / Worker Integration — Design Notes

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
`;
  try {
    const form = new FormData();
    form.append("file", new File([DOC], "auth-design-notes.md", { type: "text/markdown" }));
    const res = await fetch(
      `${BASE}/api/workspace/${WORKSPACE}/attachments?userId=u-alice&displayName=Alice%20Chen&devRole=intern`,
      { method: "POST", body: form },
    );
    if (res.ok) console.log("  1 attachment (auth-design-notes.md) — will index in ~30-60s");
    else console.log(`  attachment upload skipped (${res.status})`);
  } catch (err) {
    console.log(`  attachment upload skipped (${err.message})`);
  }

  console.log("demo-seed done.");
}

main().catch((err) => {
  console.error("demo-seed failed:", err.message);
  process.exit(1);
});
