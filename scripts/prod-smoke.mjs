/**
 * Small, targeted production smoke test — NOT a load test, NOT the full
 * adversarial suite. Run once after a deploy against the real workspace.
 * Uses real seeded identities (u-alice/u-mia/u-jordan on "demo") already
 * present in production D1. Any test data it creates is clearly labeled and
 * cleaned up where the product supports it (tasks are deleted; blockers are
 * resolved since there is no delete action).
 *
 *   node scripts/prod-smoke.mjs
 */
const BASE = process.env.INTERNPULSE_URL || "https://internpulse.amanprabhune.workers.dev";
const WS_BASE = BASE.replace(/^http/, "ws");
const WORKSPACE = "demo";
const rid = () => crypto.randomUUID();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  pass  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
}

function connect(workspace, userId, displayName) {
  return new Promise((resolve) => {
    const url = `${WS_BASE}/api/workspace/${workspace}/ws?userId=${encodeURIComponent(userId)}&displayName=${encodeURIComponent(displayName)}`;
    const ws = new WebSocket(url);
    ws.inbox = [];
    ws.opened = false;
    ws.addEventListener("message", (e) => ws.inbox.push(JSON.parse(e.data)));
    ws.addEventListener("open", () => {
      ws.opened = true;
      resolve(ws);
    });
    ws.addEventListener("error", () => resolve(ws));
    ws.addEventListener("close", () => resolve(ws));
    setTimeout(() => resolve(ws), 6000);
  });
}
const send = (ws, msg) => ws.send(JSON.stringify({ requestId: rid(), ...msg }));
async function waitFor(ws, pred, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = ws.inbox.find(pred);
    if (hit) return hit;
    await wait(50);
  }
  return null;
}
async function httpJson(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

async function main() {
  console.log(`Production smoke test -> ${BASE} (workspace="${WORKSPACE}")\n`);

  // 1. Legit member opens workspace.
  const alice = await connect(WORKSPACE, "u-alice", "Alice Chen");
  const aliceSnap = await waitFor(alice, (m) => m.type === "workspace.snapshot");
  check("legit member (Alice, real intern) opens the workspace", alice.opened && aliceSnap?.you.role === "intern");

  // 2. Non-member gets denied.
  const nobody = await connect(WORKSPACE, "qa-smoke-nobody", "QA Smoke Nobody");
  check("non-member's WS connection is denied outright", nobody.opened === false && nobody.inbox.length === 0);
  const nobodyHttp = await httpJson(`/api/workspace/${WORKSPACE}/snapshot?userId=qa-smoke-nobody&displayName=QA%20Smoke%20Nobody`);
  check("non-member's HTTP snapshot read is denied (403)", nobodyHttp.status === 403);

  const mia = await connect(WORKSPACE, "u-mia", "Mia Rivera");
  await waitFor(mia, (m) => m.type === "workspace.snapshot");

  // Tracked so `finally` below can clean up even if a later check throws —
  // a mid-run crash must never leave orphaned test data in production.
  let createdTaskId = null;
  let createdBlockerId = null;

  try {
    // 3. Task realtime sync: Alice creates, Mia observes it live over her own socket.
    const taskTitle = `QA smoke test task ${rid().slice(0, 8)}`;
    send(alice, { type: "task.create", title: taskTitle, status: "TODO", priority: "LOW" });
    const created = await waitFor(alice, (m) => m.type === "task.created" && m.task.title === taskTitle);
    if (created) createdTaskId = created.task.id;
    const miaSawIt = await waitFor(mia, (m) => m.type === "task.created" && m.task.title === taskTitle);
    check("task realtime sync: Mia's live connection receives Alice's new task", !!created && !!miaSawIt);

    // 4. Blocker action: Alice raises, Mia resolves with a note.
    const blockerDesc = `QA smoke test blocker ${rid().slice(0, 8)}`;
    send(alice, { type: "blocker.create", description: blockerDesc });
    const blockerCreated = await waitFor(alice, (m) => m.type === "blocker.created" && m.blocker.description === blockerDesc);
    check("blocker action: intern can raise a blocker", !!blockerCreated);
    if (blockerCreated) {
      createdBlockerId = blockerCreated.blocker.id;
      send(mia, { type: "blocker.resolve", id: createdBlockerId, note: "QA smoke test — resolving immediately." });
      const resolved = await waitFor(mia, (m) => m.type === "blocker.resolved" && m.blocker.id === createdBlockerId);
      check("blocker action: mentor can resolve it with a note", resolved?.blocker.status === "RESOLVED");
      if (resolved) createdBlockerId = null; // already resolved — nothing left for `finally` to clean up
    }

    // 5. Weekly flow opens (read-only — does not start a new review/workflow in prod).
    const weeklyList = await httpJson(`/api/workspace/${WORKSPACE}/weekly?userId=u-alice&displayName=Alice%20Chen`);
    check("weekly flow opens: GET /weekly returns the report list without error", weeklyList.status === 200 && Array.isArray(weeklyList.body?.reports));

    // 6. Agent responds.
    const agentRes = await httpJson(`/api/workspace/${WORKSPACE}/agent?userId=u-alice&displayName=Alice%20Chen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Summarize current progress" }),
    });
    check(
      "agent responds",
      agentRes.status === 200 && typeof agentRes.body?.answer === "string" && agentRes.body.answer.length > 0,
      JSON.stringify(agentRes.body).slice(0, 200),
    );

    // 7. Attachment list works (may be legitimately unavailable if R2 isn't enabled on this deploy).
    const attachRes = await httpJson(`/api/workspace/${WORKSPACE}/attachments?userId=u-alice&displayName=Alice%20Chen`);
    check(
      "attachment list works (200 with a list, or a clean 503 if R2 isn't enabled on this deploy)",
      attachRes.status === 200 || attachRes.status === 503,
      `status=${attachRes.status} body=${JSON.stringify(attachRes.body)}`,
    );
  } finally {
    // Cleanup runs even if a check above threw, so a crash mid-run can't
    // leave smoke-test data behind in the live workspace.
    if (createdTaskId) {
      send(alice, { type: "task.delete", id: createdTaskId });
      await waitFor(alice, (m) => m.type === "task.deleted" && m.id === createdTaskId);
      console.log("  (cleanup: smoke-test task deleted)");
    }
    if (createdBlockerId) {
      send(mia, { type: "blocker.resolve", id: createdBlockerId, note: "QA smoke test — resolving on cleanup after an error." });
      await waitFor(mia, (m) => m.type === "blocker.resolved" && m.blocker.id === createdBlockerId);
      console.log("  (cleanup: smoke-test blocker resolved after an error — no delete action exists for blockers)");
    }
    alice.close();
    mia.close();
    nobody.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("prod-smoke crashed:", err);
  process.exit(2);
});
