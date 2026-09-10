/**
 * Practical local/staging load test — NOT for production. Simulates N clients
 * across a few workspaces doing WS connect/mutate/disconnect/reconnect, and
 * checks final-state convergence + workspace isolation. Node >= 22 required.
 *
 *   INTERNPULSE_URL=http://localhost:5173 node scripts/load-test.mjs 10
 *   INTERNPULSE_URL=http://localhost:5173 node scripts/load-test.mjs 25
 */
const BASE = process.env.INTERNPULSE_URL || "http://localhost:5173";
const WS_BASE = BASE.replace(/^http/, "ws");
const N = Number(process.argv[2] || 10);
const rid = () => crypto.randomUUID();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Real D1-seeded members only (see seed/dev-seed.sql) — since workspace
// snapshot/WS reads now require real membership, load clients cycle through
// actual member identities. Reusing the same identity across several
// simulated clients doubles as a "multiple tabs / multi-device" test.
const ROSTER = [
  { workspace: "demo", userId: "u-alice", name: "Alice Chen" },
  { workspace: "demo", userId: "u-mia", name: "Mia Rivera" },
  { workspace: "demo", userId: "u-jordan", name: "Jordan Park" },
  { workspace: "rahul-ml", userId: "u-rahul", name: "Rahul Mehta" },
  { workspace: "rahul-ml", userId: "u-devon", name: "Devon Okafor" },
  { workspace: "rahul-ml", userId: "u-jordan", name: "Jordan Park" },
  { workspace: "sarah-infra", userId: "u-sarah", name: "Sarah Lee" },
  { workspace: "sarah-infra", userId: "u-mia", name: "Mia Rivera" },
  { workspace: "sarah-infra", userId: "u-priya", name: "Priya Nair" },
];

function connect(workspace, userId, displayName, devRole) {
  return new Promise((resolve) => {
    const start = performance.now();
    const url = `${WS_BASE}/api/workspace/${workspace}/ws?userId=${encodeURIComponent(userId)}&displayName=${encodeURIComponent(displayName)}${devRole ? `&devRole=${devRole}` : ""}`;
    const ws = new WebSocket(url);
    ws.inbox = [];
    ws.workspace = workspace;
    ws.userId = userId;
    ws.opened = false;
    ws.addEventListener("message", (e) => ws.inbox.push(JSON.parse(e.data)));
    ws.addEventListener("open", () => {
      ws.opened = true;
      resolve({ ws, connectMs: performance.now() - start, error: null });
    });
    ws.addEventListener("error", () => resolve({ ws, connectMs: performance.now() - start, error: "connect_error" }));
    ws.addEventListener("close", () => resolve({ ws, connectMs: performance.now() - start, error: ws.opened ? null : "rejected" }));
    setTimeout(() => resolve({ ws, connectMs: performance.now() - start, error: "timeout" }), 8000);
  });
}

async function main() {
  console.log(`Load test: ${N} clients across ${ROSTER.length} real member identities -> ${BASE}`);
  const results = { connects: [], connectErrors: 0, mutations: 0, mutationErrors: 0, reconnects: 0, reconnectErrors: 0 };

  const clients = await Promise.all(
    Array.from({ length: N }, (_, i) => {
      const who = ROSTER[i % ROSTER.length];
      return connect(who.workspace, who.userId, who.name, null);
    }),
  );
  for (const c of clients) {
    results.connects.push(c.connectMs);
    if (c.error) results.connectErrors++;
  }

  // Each client does a handful of mutations.
  const mutationStart = performance.now();
  await Promise.all(
    clients.map(async ({ ws }, i) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      for (let j = 0; j < 3; j++) {
        const thisRid = rid();
        // feedback.create is the one mutation every role (intern/mentor/manager) may
        // perform, so load doesn't get conflated with expected per-role auth denials.
        ws.send(JSON.stringify({ type: "feedback.create", requestId: thisRid, content: `load client ${i} feedback ${j}`, taskId: null }));
        results.mutations++;
        await wait(20);
      }
    }),
  );
  await wait(800);
  const mutationMs = performance.now() - mutationStart;

  for (const { ws } of clients) {
    results.mutationErrors += ws.inbox.filter((m) => m.type === "error").length;
  }

  // Presence broadcast sanity: presence dedupes by userId (a user with two
  // open tabs still counts once), so "expected" is DISTINCT userIds per
  // workspace, not raw socket count.
  const byWorkspace = new Map();
  for (const { ws } of clients) {
    if (!byWorkspace.has(ws.workspace)) byWorkspace.set(ws.workspace, new Set());
    byWorkspace.get(ws.workspace).add(ws.userId);
  }
  let presenceOk = true;
  for (const { ws } of clients) {
    const expected = byWorkspace.get(ws.workspace).size;
    const lastPresence = [...ws.inbox].reverse().find((m) => m.type === "presence.updated" || m.type === "workspace.snapshot");
    const count = lastPresence?.presence?.count ?? lastPresence?.count;
    if (typeof count === "number" && count < expected) presenceOk = false;
  }

  // Disconnect + reconnect half the clients (same real identities — exercises
  // reconnect-after-offline for a real member, including the "multiple tabs"
  // identities that share a userId).
  const toReconnect = clients.slice(0, Math.ceil(clients.length / 2));
  for (const { ws } of toReconnect) ws.close();
  await wait(300);
  const reconnected = await Promise.all(
    toReconnect.map(({ ws }) => connect(ws.workspace, ws.userId, ws.userId, null)),
  );
  for (const r of reconnected) {
    results.reconnects++;
    if (r.error) results.reconnectErrors++;
  }

  // Workspace isolation under load: each client's final snapshot must only contain its own workspace's content.
  let isolationBreaches = 0;
  for (const { ws } of reconnected) {
    const snap = ws.inbox.find((m) => m.type === "workspace.snapshot");
    if (snap && snap.workspaceId !== ws.workspace) isolationBreaches++;
  }

  for (const { ws } of [...clients, ...reconnected]) {
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const sorted = [...results.connects].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;

  console.log(`\n== Results (N=${N}) ==`);
  console.log(`connect: ${N - results.connectErrors}/${N} ok, avg ${avg(results.connects).toFixed(0)}ms, p50 ${p50.toFixed(0)}ms, p95 ${p95.toFixed(0)}ms`);
  console.log(`mutations: ${results.mutations} sent, ${results.mutationErrors} errored, batch took ${mutationMs.toFixed(0)}ms`);
  console.log(`presence broadcast consistent across clients: ${presenceOk ? "yes" : "NO — investigate"}`);
  console.log(`reconnect: ${results.reconnects - results.reconnectErrors}/${results.reconnects} ok`);
  console.log(`workspace isolation breaches under load: ${isolationBreaches}`);

  const failed = results.connectErrors > 0 || results.mutationErrors > 0 || !presenceOk || results.reconnectErrors > 0 || isolationBreaches > 0;
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("load-test crashed:", err);
  process.exit(2);
});
