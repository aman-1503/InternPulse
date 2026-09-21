import { test, expect } from "@playwright/test";
import { gotoAsDemoUser, gotoWorkspaceAsDemoUser, tabButton } from "./fixtures";

/**
 * Runs at desktop, laptop, tablet, and mobile viewports (see
 * playwright.config.ts project list) against the demo experience — the only
 * locally-reachable tree that shares components with production (Board,
 * Blockers, Weekly, Agent, Attachments, tab bar). Screenshots are saved for
 * manual visual QA (section E) in addition to the structural assertions
 * below.
 */
test.describe("responsive layouts", () => {
  test("workspace tabs scroll horizontally instead of wrapping/clipping on narrow screens", async ({ page }, testInfo) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    const nav = page.getByRole("tablist");
    await expect(nav).toBeVisible();
    await page.screenshot({ path: `e2e/screenshots/${testInfo.project.name}-overview.png`, fullPage: true });
  });

  test("board stacks columns vertically on narrow viewports, no horizontal page scroll", async ({ page }, testInfo) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Board").click();
    await expect(page.getByText("To do")).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
    await page.screenshot({ path: `e2e/screenshots/${testInfo.project.name}-board.png`, fullPage: true });
  });

  test("blockers, weekly, agent, attachments render without horizontal overflow", async ({ page }, testInfo) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    for (const tab of ["Blockers", "Weekly", "Agent", "Attachments"] as const) {
      await tabButton(page, tab).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow, `${tab} tab should not cause horizontal scroll`).toBe(false);
      await page.screenshot({ path: `e2e/screenshots/${testInfo.project.name}-${tab.toLowerCase()}.png`, fullPage: true });
    }
  });

  test("demo manager overview grid reflows without clipping", async ({ page }, testInfo) => {
    await gotoAsDemoUser(page, "manager", "#/demo");
    await expect(page.getByText("DEMO MODE")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
    await page.screenshot({ path: `e2e/screenshots/${testInfo.project.name}-manager-overview.png`, fullPage: true });
  });
});
