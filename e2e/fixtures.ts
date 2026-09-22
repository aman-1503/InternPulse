import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Demo identities seeded into workspace "demo" (see seed/dev-seed.sql):
 * Alice Chen = intern, Mia Rivera = mentor, Jordan Park = manager. Using
 * these (rather than a guest + dev-role picker) means D1 resolves a REAL
 * role server-side, exactly like production — the only thing "demo" about
 * them is that there's no Cloudflare Access challenge in front of them.
 */
export const DEMO_USERS = {
  intern: { userId: "u-alice", displayName: "Alice Chen" },
  mentor: { userId: "u-mia", displayName: "Mia Rivera" },
  manager: { userId: "u-jordan", displayName: "Jordan Park" },
} as const;

export type DemoRole = keyof typeof DEMO_USERS;

const ID_KEY = "internpulse.identity.v2";

/**
 * Sets the demo identity in localStorage *before* the app's first script
 * runs, then navigates to the given demo hash. This is the same storage key
 * `useIdentity()` reads (src/client/identity.ts) — no app code is bypassed,
 * we're just pre-seeding the one piece of client-side state the demo
 * identity switcher itself writes when a human clicks it.
 */
export async function gotoAsDemoUser(page: Page, role: DemoRole, hash = "#/demo"): Promise<void> {
  const user = DEMO_USERS[role];
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [ID_KEY, JSON.stringify(user)],
  );
  // A hash-only URL change is a same-document navigation in the browser —
  // it would NOT reload the SPA or re-run the init script above, so a
  // second call with a different role but the same hash (e.g. switching
  // identity while staying on the same workspace) would silently keep the
  // previous identity. A unique query string forces a real, fresh
  // navigation every time (the server's SPA fallback serves index.html for
  // any unmatched path/query — see wrangler.jsonc `not_found_handling`);
  // the query has no effect on the app's hash-based router.
  await page.goto(`/?e2e=${Date.now()}${Math.random().toString(36).slice(2)}${hash}`);
}

export async function gotoWorkspaceAsDemoUser(page: Page, role: DemoRole, workspaceId = "demo"): Promise<void> {
  await gotoAsDemoUser(page, role, `#/demo/w/${workspaceId}`);
  await waitForSocketOpen(page);
}

/** Waits for the workspace WebSocket to report "open" (see Presence.tsx data-testid). */
export async function waitForSocketOpen(page: Page): Promise<void> {
  await expect(page.getByTestId("socket-status")).toHaveText("open", { timeout: 15_000 });
}

/** Workspace tab buttons carry a count badge in their accessible name (e.g. "Blockers 3"). */
export function tabButton(page: Page, name: string) {
  return page.getByRole("tab", { name: new RegExp(`^${name}\\b`) });
}
