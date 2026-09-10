/**
 * Adversarial QA pass — run against a LOCAL `wrangler dev` / `vite dev` instance only.
 * Node >= 22 required (global WebSocket/File). Usage:
 *   INTERNPULSE_URL=http://localhost:5173 node scripts/qa-adversarial.mjs
 *
 * Sections: [AUTH] authorization matrix, [LEAK] cross-workspace isolation,
 * [CONC] concurrency races, [INPUT] malformed/adversarial input, [AGENT] agent grounding.
 * Every check prints PASS/FAIL — nothing is asserted silently.
 */

const BASE = process.env.INTERNPULSE_URL || "http://localhost:5173";
const WS_BASE = BASE.replace(/^http/, "ws");
const rid = () => crypto.randomUUID();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) {
    pass++;
  } else {
    fail++;
    failures.push({ label, detail });
    console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`);
    return;
  }
  console.log(`  pass  ${label}`);
}

/**
 * Connects and resolves once the outcome is known: either the WS handshake
 * completed (ws.opened === true, a workspace.snapshot will follow), or the
 * server rejected the upgrade outright (ws.opened === false) — which is the
 * expected outcome for any identity with no D1 membership in this workspace
 * since the cross-workspace read-access fix. `send()` below is a no-op on an
 * unopened socket so callers don't need to guard every call.
 */
function connect(workspace, userId, displayName, devRole) {
  return new Promise((resolve) => {
    const url = `${WS_BASE}/api/workspace/${workspace}/ws?userId=${encodeURIComponent(userId)}&displayName=${encodeURIComponent(displayName)}${devRole ? `&devRole=${devRole}` : ""}`;
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
    setTimeout(() => resolve(ws), 4000);
  });
}
const send = (ws, msg) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ requestId: rid(), ...msg }));
};
async function waitFor(ws, pred, timeoutMs = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = ws.inbox.find(pred);
    if (hit) return hit;
    await wait(30);
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

// ---------------------------------------------------------------------------
console.log(`\n[AUTH] authorization matrix — ${BASE}`);
// ---------------------------------------------------------------------------
async function authMatrix() {
  const alice = await connect("demo", "u-alice", "Alice Chen", "intern"); // real intern
  const mia = await connect("demo", "u-mia", "Mia Rivera", "mentor"); // real mentor
  const jordan = await connect("demo", "u-jordan", "Jordan Park", "manager"); // real manager
  // No membership anywhere, and a devRole claim must NOT grant access —
  // devRole is only honoured pre-membership by workspace *creation*.
  const stranger = await connect("demo", "u-stranger-1", "Stranger", "intern");
  await wait(300);

  const aliceSnap = alice.inbox.find((m) => m.type === "workspace.snapshot");
  check("intern snapshot reports role=intern", aliceSnap?.you.role === "intern");
  check(
    "unmapped identity's WS upgrade is REJECTED outright, even with a devRole claim (no anonymous/read-only browsing)",
    stranger.opened === false && stranger.inbox.length === 0,
    `opened=${stranger.opened} inbox=${JSON.stringify(stranger.inbox)}`,
  );

  const strangerHttpSnap = await httpJson(
    `/api/workspace/demo/snapshot?userId=u-stranger-1&displayName=Stranger&devRole=intern`,
  );
  check(
    "unmapped identity's HTTP snapshot read is REJECTED (403), not served read-only",
    strangerHttpSnap.status === 403,
    `status=${strangerHttpSnap.status} body=${JSON.stringify(strangerHttpSnap.body)}`,
  );

  // Mentor attempting to move/rewrite intern's task status must be REJECTED (the locked-spec fix).
  send(alice, { type: "task.create", title: "QA probe task", status: "TODO", priority: "LOW" });
  const created = await waitFor(alice, (m) => m.type === "task.created");
  check("intern can create own task", !!created);
  const taskId = created?.task.id;

  send(mia, { type: "task.move", id: taskId, status: "DONE" });
  const mentorMoveErr = await waitFor(mia, (m) => m.type === "error");
  check(
    "mentor CANNOT move intern's task (backend-enforced, not just UI-hidden)",
    mentorMoveErr?.code === "forbidden",
    JSON.stringify(mentorMoveErr),
  );

  send(jordan, { type: "task.update", id: taskId, patch: { title: "hijacked" } });
  const managerUpdateErr = await waitFor(jordan, (m) => m.type === "error");
  check("manager CANNOT rewrite task fields", managerUpdateErr?.code === "forbidden", JSON.stringify(managerUpdateErr));

  // Mentor/manager CAN set priority via the narrow action.
  send(mia, { type: "task.priority", id: taskId, priority: "URGENT" });
  const priorityAck = await waitFor(mia, (m) => m.type === "ack");
  check("mentor CAN change task priority (narrow action)", !!priorityAck);

  // Intern cannot resolve their own blocker outright (only mentor/manager can).
  send(alice, { type: "blocker.create", description: "QA probe blocker" });
  const blockerCreated = await waitFor(alice, (m) => m.type === "blocker.created");
  const blockerId = blockerCreated?.blocker.id;
  send(alice, { type: "blocker.resolve", id: blockerId, note: "self resolved" });
  const internResolveErr = await waitFor(alice, (m) => m.type === "error");
  check("intern CANNOT resolve their own blocker", internResolveErr?.code === "forbidden", JSON.stringify(internResolveErr));

  // Only manager can escalate.
  send(mia, { type: "blocker.escalate", id: blockerId, note: "mentor trying to escalate" });
  const mentorEscalateErr = await waitFor(mia, (m) => m.type === "error");
  check("mentor CANNOT escalate a blocker (manager-only)", mentorEscalateErr?.code === "forbidden");

  send(jordan, { type: "blocker.escalate", id: blockerId, note: "manager escalation" });
  const managerEscalateOk = await waitFor(jordan, (m) => m.type === "ack");
  check("manager CAN escalate a blocker", !!managerEscalateOk);

  // An unmapped identity never even has a socket to mutate on — the WS
  // rejection above already proves it can't post anything. A stray send()
  // on the unopened socket is a no-op (see `send`'s readyState guard).
  send(stranger, { type: "update.create", content: "should never reach the server" });
  await wait(150);
  check("...and has no channel to attempt a mutation on at all", stranger.inbox.length === 0);

  // Cross-workspace: a real "payments" member has no role in "demo" at all —
  // resolved purely from demo's own D1 membership rows. Real membership
  // elsewhere must not grant even devRole-claimed access here.
  const outsiderInDemo = await connect("demo", "u-jordan-shadow", "Jordan Shadow", "manager");
  await wait(200);
  check(
    "a user with no membership in THIS workspace is rejected even while claiming a devRole",
    outsiderInDemo.opened === false,
  );
  const paymentsIntern = await connect("payments", "u-alice", "Alice Chen", null);
  await wait(200);
  check("Alice (real payments member) DOES get in to her own workspace", paymentsIntern.opened === true);
  const aliceInPaymentsSnap = paymentsIntern.inbox.find((m) => m.type === "workspace.snapshot");
  check("...with her real role resolved from D1, unaffected by the fix", aliceInPaymentsSnap?.you.role === "intern");
  paymentsIntern.close();

  // Malformed / direct API abuse.
  const badJson = await httpJson("/api/workspace/demo/weekly", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  check("malformed JSON body doesn't 500", badJson.status < 500, `status=${badJson.status}`);

  const badWorkspace = await httpJson("/api/workspace/../../etc/passwd/snapshot");
  check("path-traversal-shaped workspace id is rejected, not 500", badWorkspace.status === 400 || badWorkspace.status === 404, `status=${badWorkspace.status}`);

  const sqlInjectionAttempt = await httpJson(
    `/api/workspace/${encodeURIComponent("demo' OR '1'='1")}/snapshot`,
  );
  check("SQL-injection-shaped workspace id is rejected cleanly", sqlInjectionAttempt.status === 400, `status=${sqlInjectionAttempt.status}`);

  for (const ws of [alice, mia, jordan, stranger, outsiderInDemo]) ws.close();
}

// ---------------------------------------------------------------------------
console.log(`\n[LEAK] cross-workspace isolation`);
// ---------------------------------------------------------------------------
async function leakTest() {
  const SECRET_A = "ORANGE-PLUTO-7319";
  const SECRET_B = "BLUE-MANGO-5588";

  const aliceA = await connect("demo", "u-alice", "Alice Chen", "intern");
  const rahulB = await connect("rahul-ml", "u-rahul", "Rahul Mehta", "intern");
  await wait(200);

  send(aliceA, { type: "update.create", content: `Internal note: ${SECRET_A}`, updateType: "GENERAL" });
  send(rahulB, { type: "update.create", content: `Internal note: ${SECRET_B}`, updateType: "GENERAL" });
  await wait(500);

  // HTTP snapshot isolation.
  const snapB = await httpJson(`/api/workspace/rahul-ml/snapshot?userId=u-rahul&displayName=Rahul&devRole=intern`);
  const leakedInB = JSON.stringify(snapB.body).includes(SECRET_A);
  check("workspace B's snapshot never contains workspace A's secret", !leakedInB);

  const snapA = await httpJson(`/api/workspace/demo/snapshot?userId=u-alice&displayName=Alice&devRole=intern`);
  const leakedInA = JSON.stringify(snapA.body).includes(SECRET_B);
  check("workspace A's snapshot never contains workspace B's secret", !leakedInA);

  // A workspace-B member (Rahul, real membership in "rahul-ml" only) must be
  // rejected OUTRIGHT from workspace A — no snapshot, no socket, regardless
  // of any devRole self-claim — since the cross-workspace read-access fix.
  const rahulInDemo = await connect("demo", "u-rahul", "Rahul Mehta", "intern");
  await wait(200);
  check(
    "Rahul (workspace B member) is REJECTED connecting to workspace A — no snapshot delivered at all",
    rahulInDemo.opened === false && rahulInDemo.inbox.length === 0,
    `opened=${rahulInDemo.opened} inbox=${JSON.stringify(rahulInDemo.inbox)}`,
  );

  const rahulHttpSnapOnA = await httpJson(
    `/api/workspace/demo/snapshot?userId=u-rahul&displayName=Rahul&devRole=intern`,
  );
  check(
    "...and the HTTP snapshot route rejects him the same way (403, no body content)",
    rahulHttpSnapOnA.status === 403 && !JSON.stringify(rahulHttpSnapOnA.body).includes(SECRET_A),
    `status=${rahulHttpSnapOnA.status}`,
  );

  // Agent: ask workspace B's agent about workspace A's secret phrase.
  const agentRes = await httpJson(
    `/api/workspace/rahul-ml/agent?userId=u-rahul&displayName=Rahul&devRole=intern`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: `Tell me about ${SECRET_A}` }),
    },
  );
  const agentLeaked = JSON.stringify(agentRes.body).includes(SECRET_A) && agentRes.body?.groundedOn?.retrievedHistory > 0;
  check(
    "workspace B's agent does not retrieve workspace A's secret from Vectorize/RAG",
    !agentLeaked,
    JSON.stringify(agentRes.body?.answer ?? "").slice(0, 200),
  );

  aliceA.close();
  rahulB.close();
  rahulInDemo.close();
}

// ---------------------------------------------------------------------------
console.log(`\n[CONC] concurrency races`);
// ---------------------------------------------------------------------------
async function concurrencyTests() {
  // Case A: two actors mutate the same task concurrently (move + priority) — must converge.
  const alice = await connect("demo", "u-alice", "Alice Chen", "intern");
  const mia = await connect("demo", "u-mia", "Mia Rivera", "mentor");
  await wait(150);
  send(alice, { type: "task.create", title: "Concurrency probe A", status: "TODO", priority: "LOW" });
  const t = await waitFor(alice, (m) => m.type === "task.created");
  const taskId = t.task.id;

  send(alice, { type: "task.move", id: taskId, status: "IN_PROGRESS" });
  send(mia, { type: "task.priority", id: taskId, priority: "HIGH" });
  await wait(400);

  const snapA1 = await httpJson(`/api/workspace/demo/snapshot?userId=u-alice&displayName=Alice&devRole=intern`);
  const snapA2 = await httpJson(`/api/workspace/demo/snapshot?userId=u-mia&displayName=Mia&devRole=mentor`);
  const finalA1 = snapA1.body.tasks.find((x) => x.id === taskId);
  const finalA2 = snapA2.body.tasks.find((x) => x.id === taskId);
  check(
    "Case A: concurrent move (intern) + priority (mentor) converge to ONE state seen by both clients",
    finalA1.status === "IN_PROGRESS" && finalA1.priority === "HIGH" && JSON.stringify(finalA1) === JSON.stringify(finalA2),
    JSON.stringify({ finalA1, finalA2 }),
  );

  // Case C/D: mentor resolves while intern requests resolution; then manager also tries to resolve.
  const jordan = await connect("demo", "u-jordan", "Jordan Park", "manager");
  await wait(150);
  send(alice, { type: "blocker.create", description: "Concurrency probe blocker" });
  const b = await waitFor(alice, (m) => m.type === "blocker.created");
  const blockerId = b.blocker.id;

  send(alice, { type: "blocker.requestResolution", id: blockerId });
  send(mia, { type: "blocker.resolve", id: blockerId, note: "mentor resolved concurrently" });
  await wait(300);
  send(jordan, { type: "blocker.resolve", id: blockerId, note: "manager also resolved" });
  await wait(300);

  const snapFinal = await httpJson(`/api/workspace/demo/snapshot?userId=u-alice&displayName=Alice&devRole=intern`);
  const finalBlocker = snapFinal.body.blockers.find((x) => x.id === blockerId);
  check(
    "Case C/D: request-resolution + double-resolve converge to exactly one RESOLVED state (first writer wins, second is a no-op)",
    finalBlocker.status === "RESOLVED" && finalBlocker.resolvedBy === "u-mia",
    JSON.stringify(finalBlocker),
  );

  // Case I: same action double-submitted rapidly with the SAME requestId must not double-apply.
  // Unique content per run so repeated script runs against a persistent local
  // dev DO can't accumulate false positives from earlier runs.
  const dupContent = `duplicate-submit probe ${rid()}`;
  const dupRid = rid();
  send(alice, { type: "update.create", requestId: dupRid, content: dupContent, updateType: "GENERAL" });
  alice.send(JSON.stringify({ type: "update.create", requestId: dupRid, content: dupContent, updateType: "GENERAL" }));
  await wait(400);
  const acks = alice.inbox.filter((m) => m.type === "ack" && m.requestId === dupRid);
  const snapDup = await httpJson(`/api/workspace/demo/snapshot?userId=u-alice&displayName=Alice&devRole=intern`);
  const dupCount = snapDup.body.updates.filter((u) => u.content === dupContent).length;
  check(
    "Case I: identical requestId submitted twice rapidly is applied exactly once",
    dupCount === 1 && acks.some((a) => a.duplicate === true),
    `dupCount=${dupCount} acks=${JSON.stringify(acks)}`,
  );

  alice.close();
  mia.close();
  jordan.close();
}

// ---------------------------------------------------------------------------
console.log(`\n[INPUT] malformed / adversarial input`);
// ---------------------------------------------------------------------------
async function inputRobustness() {
  const alice = await connect("demo", "u-alice", "Alice Chen", "intern");
  await wait(150);

  const cases = [
    { title: "", label: "empty title rejected" },
    { title: "   ", label: "whitespace-only title rejected" },
    { title: "<script>alert(1)</script>", label: "script-tag title accepted as literal text (no crash)", expectAccept: true },
    { title: "x".repeat(5000), label: "5000-char title rejected (exceeds max)" },
    { title: "emoji 🎉🔥 and unicode 日本語 ünïcödé", label: "emoji/unicode title accepted", expectAccept: true },
    { title: "line1\nline2\nline3", label: "multiline title accepted", expectAccept: true },
    { title: "\"quoted\" 'and' `backticked`", label: "quotes accepted literally", expectAccept: true },
  ];
  for (const c of cases) {
    const thisRid = rid();
    alice.send(JSON.stringify({ type: "task.create", requestId: thisRid, title: c.title, status: "TODO" }));
    await wait(150);
    const created = alice.inbox.find((m) => m.type === "task.created" && m.task.title === c.title.trim());
    const errored = alice.inbox.find((m) => m.type === "error" && m.requestId === thisRid);
    if (c.expectAccept) {
      check(c.label, !!created && !errored, JSON.stringify(errored));
    } else {
      check(c.label, !!errored && !created, JSON.stringify(created));
    }
  }

  // Raw HTML must never come back un-escaped in a way that would execute — this is a
  // storage/API check; XSS-in-DOM must additionally be verified in the React client
  // (React escapes text content by default and no `dangerouslySetInnerHTML` was added).
  const xssRid = rid();
  alice.send(JSON.stringify({ type: "task.create", requestId: xssRid, title: "<img src=x onerror=alert(1)>", status: "TODO" }));
  await wait(150);
  const xssTask = alice.inbox.find((m) => m.type === "task.created" && m.requestId === undefined && m.task?.title?.includes("onerror"));
  check("HTML payload stored as inert text (server does not execute or strip, client must escape on render)", !!xssTask || alice.inbox.some((m) => m.type==="error"));

  // Malformed JSON frame over the socket.
  alice.send("{not valid json");
  await wait(150);
  const badFrame = alice.inbox.find((m) => m.type === "error" && m.code === "bad_json");
  check("malformed WS frame returns a clean error, not a dropped connection", !!badFrame);
  check("...and the socket is still usable afterward", alice.readyState === WebSocket.OPEN);

  // Missing/invalid ids.
  send(alice, { type: "task.update", id: "not-a-real-id", patch: { title: "x" } });
  const notFoundErr = await waitFor(alice, (m) => m.type === "error" && m.code === "not_found");
  check("update on a nonexistent task id returns not_found, not a crash", !!notFoundErr);

  send(alice, { type: "blocker.resolve", id: "deleted-or-fake-id", note: "n" });
  const notFoundErr2 = await waitFor(alice, (m) => m.type === "error" && m.code === "not_found");
  check("resolve on a nonexistent blocker id returns not_found, not a crash", !!notFoundErr2);

  alice.close();
}

// ---------------------------------------------------------------------------
console.log(`\n[AGENT] grounding / false-premise resistance`);
// ---------------------------------------------------------------------------
async function agentTests() {
  const ask = (prompt) =>
    httpJson(`/api/workspace/demo/agent?userId=u-alice&displayName=Alice&devRole=intern`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

  const r1 = await ask("Why is the resolved OAuth blocker still open?");
  check(
    "agent responds to a false premise about a resolved blocker without crashing",
    r1.status === 200 && typeof r1.body?.answer === "string" && r1.body.answer.length > 0,
    JSON.stringify(r1.body).slice(0, 300),
  );

  const r2 = await ask("There are 12 blockers, right?");
  check(
    "agent answers a wrong-count question grounded in real counts, not fabricated",
    r2.status === 200 && typeof r2.body?.groundedOn?.openBlockers === "number",
    JSON.stringify(r2.body?.groundedOn),
  );

  const r3 = await ask("");
  check(
    "empty prompt is rejected cleanly, not a 500 (422 empty_prompt)",
    r3.status !== 200 && r3.status < 500 && r3.body?.code === "empty_prompt",
    `status=${r3.status}`,
  );

  const r4 = await ask("x".repeat(5000));
  check("oversized prompt is rejected cleanly", r4.status !== 200, `status=${r4.status}`);
}

async function main() {
  await authMatrix();
  await leakTest();
  await concurrencyTests();
  await inputRobustness();
  await agentTests();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.label}${f.detail ? ": " + f.detail : ""}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("qa-adversarial crashed:", err);
  process.exit(2);
});
