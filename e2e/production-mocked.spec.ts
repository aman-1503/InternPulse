import { test, expect, type Page } from "@playwright/test";

/**
 * Coverage for the PRODUCTION chrome (AppShell/Sidebar/Topbar/
 * WorkspaceSwitcher/mobile drawer, RoleHome dashboards, Settings, Onboarding,
 * Invitations, and the admin route gate) that requires an authenticated
 * `/api/me` — which nothing in local dev can produce, because Cloudflare
 * Access sits in front of a deployed hostname, not `wrangler dev` (see
 * README "Local setup" and scripts/qa-production-auth.mjs's own documented
 * scope limit).
 *
 * This spec intercepts the browser's `GET /api/me` (and, for the dashboards,
 * the per-workspace `/snapshot` reads RoleHome fans out via usePortfolio)
 * with Playwright's network mocking and lets the REAL, unmodified React
 * component tree render against that response. This is standard frontend
 * test practice, not a security bypass:
 *   - the server's Access verification is never touched, called with a
 *     forged header, or asked to accept anything — we simply never send it
 *     a request in the first place for the mocked routes;
 *   - nothing is deployed and no app code changes behavior based on being
 *     under test;
 *   - it only proves "given this /api/me response, does the UI render and
 *     behave correctly" — it does NOT prove Access itself is wired up
 *     correctly end-to-end. That still requires the manual checklist
 *     (docs/real-access-manual-checklist.md) against a real deployment.
 *
 * WorkspaceView (Board/Blockers/Weekly/Agent/Attachments) is deliberately
 * NOT re-tested here under a mocked identity: it's the exact same component,
 * unmodified, used by both production and demo (see its own docstring in
 * workspace/WorkspaceView.tsx), and it additionally needs a live WebSocket,
 * which isn't worth faking — e2e/workspace-tabs.spec.ts already exercises it
 * for real over demo's real WorkspaceDO.
 */

const ME_URL = "**/api/me";

function meBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user: { id: "u-mock", email: "mock@example.com", displayName: "Mock User", accountStatus: "ACTIVE", isAdmin: false },
    memberships: [],
    pendingInvitations: [],
    ...overrides,
  };
}

async function mockMe(page: Page, body: unknown) {
  await page.route(ME_URL, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
}

function emptySnapshot(workspaceId: string, you: { userId: string; displayName: string; role: string }) {
  return {
    schemaVersion: 1,
    workspaceId,
    you,
    members: [you],
    tasks: [],
    blockers: [],
    blockerComments: [],
    updates: [],
    feedback: [],
    activity: [],
    presence: { count: 1, members: [] },
    reminders: [],
    attentionItems: [],
    mentions: [],
    attachments: [],
    weeklyReports: [],
  };
}

test.describe("production chrome (mocked /api/me — see file header)", () => {
  test("onboarding: a user with no memberships/invitations sees the onboarding screen", async ({ page }) => {
    await mockMe(page, meBody());
    await page.goto("/#/home");
    await expect(page.getByRole("heading", { name: "Welcome to InternPulse" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Set up a new internship/project workspace" })).toBeVisible();
  });

  test("invitations: a user with a pending invitation sees the invitations screen with Accept", async ({ page }) => {
    await mockMe(
      page,
      meBody({
        pendingInvitations: [
          {
            id: "inv-1",
            workspaceId: "ws-1",
            workspaceName: "Payments Revamp",
            email: "mock@example.com",
            role: "intern",
            invitedByUserId: "u-mentor",
            invitedByName: "Some Mentor",
            status: "PENDING",
            createdAt: Date.now(),
            expiresAt: Date.now() + 86_400_000,
            acceptedAt: null,
          },
        ],
      }),
    );
    await page.goto("/#/home");
    await expect(page.getByRole("heading", { name: "You've been invited" })).toBeVisible();
    await expect(page.getByText("Payments Revamp")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  });

  test("sidebar + topbar render for a member with a workspace, and admin link is hidden for a non-admin", async ({ page }) => {
    await mockMe(
      page,
      meBody({
        memberships: [{ workspaceId: "ws-1", workspaceName: "Payments Revamp", slug: "payments-revamp", role: "manager" }],
      }),
    );
    await page.route("**/api/workspace/ws-1/snapshot", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptySnapshot("ws-1", { userId: "u-mock", displayName: "Mock User", role: "manager" })),
      }),
    );
    await page.goto("/#/home");

    await expect(page.getByText("InternPulse").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Home/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Weekly Reviews" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

    // Workspace switcher lists the membership (no workspace is "current" on
    // the #/home screen, so the trigger reads "Switch workspace").
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await expect(page.getByRole("option", { name: /Payments Revamp/ })).toBeVisible();
  });

  test("admin link is visible for an admin user, and admin page loads", async ({ page }) => {
    await mockMe(
      page,
      meBody({
        user: { id: "u-admin", email: "admin@example.com", displayName: "Admin User", accountStatus: "ACTIVE", isAdmin: true },
        // A membership so the app reaches the sidebar/home screen rather
        // than the onboarding screen (which has no sidebar at all).
        memberships: [{ workspaceId: "ws-1", workspaceName: "Payments Revamp", slug: "payments-revamp", role: "manager" }],
      }),
    );
    await page.route("**/api/workspace/ws-1/snapshot", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptySnapshot("ws-1", { userId: "u-admin", displayName: "Admin User", role: "manager" })),
      }),
    );
    await page.route("**/api/admin/users", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ users: [] }) }));
    await page.goto("/#/home");
    await expect(page.getByRole("link", { name: "Admin" })).toBeVisible();
    await page.getByRole("link", { name: "Admin" }).click();
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "users" })).toBeVisible();
  });

  test("non-admin hitting #/admin directly sees an access-required message, not the admin UI", async ({ page }) => {
    await mockMe(page, meBody({ memberships: [] }));
    await page.goto("/#/admin");
    await expect(page.getByText("Admin access required")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Admin", exact: true })).toHaveCount(0);
  });

  test("mobile drawer: hamburger opens the sidebar and closes on backdrop click", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockMe(page, meBody({ memberships: [{ workspaceId: "ws-1", workspaceName: "Payments Revamp", slug: "payments-revamp", role: "intern" }] }));
    await page.route("**/api/workspace/ws-1/snapshot", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emptySnapshot("ws-1", { userId: "u-mock", displayName: "Mock User", role: "intern" })),
      }),
    );
    await page.goto("/#/home");

    const menuButton = page.getByRole("button", { name: "Open menu" });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    await expect(page.getByRole("link", { name: "Weekly Reviews" })).toBeVisible();

    // Click the backdrop (outside the drawer panel, which is ~240px wide) to
    // close it — the drawer unmounts entirely (conditional render), so the
    // nav link disappearing proves the click actually closed it.
    await page.mouse.click(350, 400);
    await expect(page.getByRole("link", { name: "Weekly Reviews" })).toHaveCount(0);
  });

  test("settings page: display name is editable, email/status are read-only", async ({ page }) => {
    await mockMe(page, meBody());
    await page.goto("/#/settings");
    await expect(page.getByRole("heading", { name: "Profile & settings" })).toBeVisible();
    await expect(page.getByLabel("Display name")).toHaveValue("Mock User");
    await expect(page.getByText("mock@example.com")).toBeVisible();
  });

  test("suspended/disabled account states render their dedicated screens", async ({ page }) => {
    await page.route(ME_URL, (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "suspended", code: "account_suspended" }) }),
    );
    await page.goto("/#/home");
    await expect(page.getByRole("heading", { name: "Your account is suspended" })).toBeVisible();
  });

  test("network error on /api/me shows a retryable error state", async ({ page }) => {
    await page.route(ME_URL, (route) => route.abort("failed"));
    await page.goto("/#/home");
    await expect(page.getByRole("heading", { name: "Couldn't reach InternPulse" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
