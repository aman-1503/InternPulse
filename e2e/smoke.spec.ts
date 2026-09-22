import { test, expect } from "@playwright/test";
import { gotoAsDemoUser, gotoWorkspaceAsDemoUser } from "./fixtures";

test.describe("app load / production-demo separation", () => {
  test("root loads the InternPulse shell", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("InternPulse");
  });

  test("production root with no Access identity shows the sign-in-required state, not a raw error", async ({ page }) => {
    // Local dev has no way to satisfy a real Cloudflare Access challenge (see
    // README "Local setup") — asserting the app degrades to this explicit,
    // human-readable screen (rather than a stuck spinner or blank page) IS
    // the correct local behavior, not a workaround.
    await page.goto("/#/home");
    await expect(page.getByRole("heading", { name: "Sign-in required" })).toBeVisible();
    await expect(page.getByText(/Cloudflare Access/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  });

  test("production admin/settings/onboarding routes all gate behind the same sign-in-required screen", async ({ page }) => {
    for (const hash of ["#/admin", "#/settings", "#/onboarding", "#/invitations", "#/workspaces/new"]) {
      await page.goto(`/${hash}`);
      await expect(page.getByRole("heading", { name: "Sign-in required" })).toBeVisible();
    }
  });

  test("demo route loads with the DEMO MODE badge and demo identity switcher", async ({ page }) => {
    await gotoAsDemoUser(page, "intern", "#/demo");
    await expect(page.getByText("DEMO MODE")).toBeVisible();
    await expect(page.getByText("Alice Chen · role from D1")).toBeVisible();
  });

  test("demo workspace never calls production /api/workspace/*, only /api/demo/*", async ({ page }) => {
    const productionCalls: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith("/api/workspace/")) productionCalls.push(url.pathname);
    });
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await expect(page.getByText("demo identity", { exact: false })).toBeVisible();
    expect(productionCalls).toEqual([]);
  });

  test("production route refuses to resolve a demo (is_demo=1) workspace id", async ({ request }) => {
    const res = await request.get("/api/workspace/demo/summary");
    expect(res.status()).toBe(404);
  });

  test("a garbage Access assertion header is rejected the same as no header (fails closed, not 500)", async ({ request }) => {
    const res = await request.get("/api/workspace/demo/snapshot", {
      headers: { "Cf-Access-Jwt-Assertion": "not.a.valid.jwt" },
    });
    expect(res.status()).toBe(401);
  });
});
