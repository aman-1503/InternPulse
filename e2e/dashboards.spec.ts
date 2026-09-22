import { test, expect } from "@playwright/test";
import { gotoAsDemoUser, gotoWorkspaceAsDemoUser } from "./fixtures";

/**
 * "Dashboard" coverage. RoleHome (Intern/Mentor/ManagerHome under
 * `#/home`) is production-only and requires a real Cloudflare Access
 * session — see e2e/production-mocked.spec.ts for that (network-mocked)
 * coverage. Here we exercise the same role-curated logic through its
 * demo-reachable equivalents: WorkspaceView's OverviewTab (shared,
 * unmodified, by production and demo — see workspace/WorkspaceView.tsx
 * docstring) and the demo ManagerOverview screen.
 */
test.describe("role-curated dashboards (demo)", () => {
  test("intern overview: daily update composer + urgent/high tasks section", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await expect(page.getByRole("heading", { name: "Latest update" })).toBeVisible();
    await expect(page.getByPlaceholder("What are you working on today?")).toBeVisible();
    await expect(page.getByRole("heading", { name: /My urgent\/high tasks/ })).toBeVisible();
  });

  test("mentor overview: reports-waiting-for-review section, not the intern's composer", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "mentor", "demo");
    await expect(page.getByRole("heading", { name: "Weekly reports waiting for review" })).toBeVisible();
    await expect(page.getByPlaceholder("What are you working on today?")).toHaveCount(0);
  });

  test("manager overview: approved-reports section", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "manager", "demo");
    await expect(page.getByRole("heading", { name: "Approved reports" })).toBeVisible();
  });

  test("demo manager-overview screen lists workspaces and opens one", async ({ page }) => {
    await gotoAsDemoUser(page, "manager", "#/demo");
    await expect(page.getByText("DEMO MODE")).toBeVisible();
    const workspaceLink = page.getByText("Authentication / Worker Integration").first();
    await expect(workspaceLink).toBeVisible();
    await workspaceLink.click();
    await expect(page).toHaveURL(/#\/demo\/w\/demo/);
  });

  test("role changes what the same Overview tab shows for the same workspace", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await expect(page.getByRole("heading", { name: "Latest update" })).toBeVisible();

    await gotoWorkspaceAsDemoUser(page, "manager", "demo");
    await expect(page.getByRole("heading", { name: "Latest update" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Approved reports" })).toBeVisible();
  });
});
