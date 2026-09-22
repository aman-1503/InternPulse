/**
 * Adversarial QA for the PRODUCTION auth boundary — run against a LOCAL
 * `wrangler dev` instance with ACCESS_TEAM_DOMAIN/ACCESS_AUD left UNSET (the
 * default local dev config). That means every production route must fail
 * closed with 401, regardless of anything the client sends, which is exactly
 * what this script proves.
 *
 * What this script deliberately does NOT cover: any check that requires a
 * REAL, validly-signed Cloudflare Access JWT (e.g. "admin route rejects a
 * MANAGER", "invitation acceptance rejects a mismatched email", "workspace
 * creation validates creatorRole"). Those paths are covered by fast, real-SQL
 * unit tests instead (see src/worker/production-identity.test.ts,
 * invitations.test.ts, admin-routes.test.ts) — this script has no way to mint
 * a session Cloudflare Access would accept. After Access is provisioned, walk
 * the manual journeys in README "Cloudflare Access setup" once as a real
 * end-to-end check.
 *
 *   INTERNPULSE_URL=http://localhost:8787 node scripts/qa-production-auth.mjs
 */
const BASE = process.env.INTERNPULSE_URL || "http://localhost:8787";
const WS_BASE = BASE.replace(/^http/, "ws");

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

async function status(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  return res.status;
}

console.log(`\n[PROD-AUTHZ] every production route fails closed without a verified Access identity — ${BASE}`);
{
  const routes = [
    ["GET", "/api/workspace/demo/snapshot"],
    ["GET", "/api/workspace/demo/summary"], // summary is identity-free, but still scope-gated (see [SCOPE])
    ["GET", "/api/workspace/demo/agent"],
    ["POST", "/api/workspace/demo/agent"],
    ["GET", "/api/workspace/demo/weekly"],
    ["GET", "/api/workspace/demo/reminders"],
    ["GET", "/api/workspace/demo/attachments"],
    ["GET", "/api/workspace/demo/invitations"],
    ["POST", "/api/workspace/demo/members"],
    ["GET", "/api/workspaces"],
    ["POST", "/api/workspaces"],
    ["GET", "/api/overview"],
    ["GET", "/api/me"],
    ["GET", "/api/admin/users"],
    ["GET", "/api/admin/audit"],
    ["POST", "/api/invitations/some-id/accept"],
  ];
  for (const [method, path] of routes) {
    if (path === "/api/workspace/demo/summary") continue; // checked separately below
    const code = await status(path, { method });
    check(`${method} ${path} with no Cf-Access-Jwt-Assertion header -> 401`, code === 401, `got ${code}`);
  }
}

console.log(`\n[PROD-AUTHZ] a garbage/forged assertion header is rejected the same way as no header at all`);
{
  const code = await status("/api/workspace/demo/snapshot", {
    headers: { "Cf-Access-Jwt-Assertion": "not.a.valid.jwt" },
  });
  check("malformed Cf-Access-Jwt-Assertion -> 401 (not a 500, not treated as trusted)", code === 401, `got ${code}`);
}

console.log(`\n[PROD-TAMPER] client-supplied identity/role query params have zero effect on production routes`);
{
  const withoutQuery = await status("/api/workspace/demo/snapshot");
  const withForgedQuery = await status(
    "/api/workspace/demo/snapshot?userId=u-jordan&displayName=Jordan&devRole=manager&role=manager",
  );
  check(
    "adding userId/devRole/role query params to a production route changes nothing (still 401)",
    withoutQuery === 401 && withForgedQuery === 401,
    `no-query=${withoutQuery} forged-query=${withForgedQuery}`,
  );
}
{
  const code = await status("/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Attacker Workspace", creatorRole: "manager" }),
  });
  check("POST /api/workspaces (production) with a spoofed creatorRole body but no auth -> 401", code === 401, `got ${code}`);
}

console.log(`\n[SCOPE] production routes refuse to serve a demo (is_demo=1) workspace, even for the unauthenticated-check itself`);
{
  // summary needs no identity, but is still scope-gated: a demo workspace id
  // must never resolve via the production route.
  const prodSummary = await status("/api/workspace/demo/summary");
  const demoSummary = await status("/api/demo/workspace/demo/summary");
  check("production /summary for a demo workspace id -> 404 (not served)", prodSummary === 404, `got ${prodSummary}`);
  check("demo /summary for the same id via /api/demo/ -> 200", demoSummary === 200, `got ${demoSummary}`);
}
{
  const prodSummaryUnknown = await status("/api/workspace/does-not-exist/summary");
  check("production /summary for a nonexistent workspace id -> 404", prodSummaryUnknown === 404, `got ${prodSummaryUnknown}`);
}

console.log(`\n[SCOPE] demo routes refuse identities/workspaces outside the demo sandbox`);
{
  const demoModeOff = process.env.INTERNPULSE_DEMO_MODE_OFF === "1";
  if (demoModeOff) {
    const code = await status("/api/demo/workspace/demo/snapshot?userId=u-alice&displayName=Alice");
    check("DEMO_MODE=off disables /api/demo/* entirely -> 404", code === 404, `got ${code}`);
  } else {
    console.log("  skip  (set INTERNPULSE_DEMO_MODE_OFF=1 against a build with DEMO_MODE=off to exercise this)");
  }
}

console.log(`\n[WS] a WebSocket upgrade to a production route without auth is rejected before ever reaching the DO`);
{
  await new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}/api/workspace/demo/ws`);
    let settled = false;
    const finish = (ok, detail) => {
      if (settled) return;
      settled = true;
      check("production WS upgrade with no Access header never opens", ok, detail);
      resolve();
    };
    ws.addEventListener("open", () => finish(false, "socket OPENED — should have been rejected"));
    ws.addEventListener("error", () => finish(true));
    ws.addEventListener("close", () => finish(true));
    setTimeout(() => finish(false, "timed out without close/error"), 4000);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
