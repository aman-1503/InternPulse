import { test, expect } from "@playwright/test";
import { gotoAsDemoUser, gotoWorkspaceAsDemoUser, tabButton, waitForSocketOpen } from "./fixtures";

/**
 * UI-reachable adversarial cases. Pure-API adversarial cases (forged
 * headers, cross-tenant tampering, malformed bodies) are already covered by
 * scripts/qa-adversarial.mjs and scripts/qa-production-auth.mjs — this file
 * only covers what requires a real rendered browser: races between two
 * live clients, stale state, refresh-mid-mutation, and role/permission UI
 * enforcement.
 */
test.describe("adversarial UI / realtime cases", () => {
  test("two mentors/managers resolving the same blocker nearly simultaneously — second click doesn't crash or double-resolve", async ({ browser }) => {
    const mentorCtx = await browser.newContext();
    const mentorPage = await mentorCtx.newPage();
    const managerCtx = await browser.newContext();
    const managerPage = await managerCtx.newPage();

    await gotoWorkspaceAsDemoUser(mentorPage, "mentor", "demo");
    await gotoWorkspaceAsDemoUser(managerPage, "manager", "demo");

    // Intern raises a fresh blocker via mentor context is not allowed — raise
    // it via a third, real intern context instead.
    const internCtx = await browser.newContext();
    const internPage = await internCtx.newPage();
    await gotoWorkspaceAsDemoUser(internPage, "intern", "demo");

    const desc = `Race blocker ${Date.now()}`;
    await tabButton(internPage, "Blockers").click();
    await internPage.getByPlaceholder(/Describe what's blocking you/).fill(desc);
    await internPage.getByRole("button", { name: "Raise blocker" }).click();

    await tabButton(mentorPage, "Blockers").click();
    await tabButton(managerPage, "Blockers").click();
    const mentorCard = mentorPage.locator("li", { hasText: desc });
    const managerCard = managerPage.locator("li", { hasText: desc });
    await expect(mentorCard).toBeVisible({ timeout: 10_000 });
    await expect(managerCard).toBeVisible({ timeout: 10_000 });

    await mentorCard.getByRole("button", { name: "Resolve" }).click();
    await managerCard.getByRole("button", { name: "Resolve" }).click();
    await mentorCard.getByPlaceholder("Resolution note (required)").fill("mentor note");
    await managerCard.getByPlaceholder("Resolution note (required)").fill("manager note");

    // Fire both "confirm resolve" as close together as Playwright allows.
    await Promise.all([
      mentorCard.getByRole("button", { name: "Confirm resolve" }).click(),
      managerCard.getByRole("button", { name: "Confirm resolve" }).click(),
    ]);

    // Whichever wins, both clients converge on exactly one resolved state —
    // no crash, no duplicate blocker, no stuck UI.
    await expect(mentorPage.locator("li", { hasText: desc })).toContainText(/Resolved by/, { timeout: 10_000 });
    await expect(managerPage.locator("li", { hasText: desc })).toContainText(/Resolved by/, { timeout: 10_000 });
    await expect(mentorPage.locator("li", { hasText: desc })).toHaveCount(1);
    await expect(managerPage.locator("li", { hasText: desc })).toHaveCount(1);

    await mentorCtx.close();
    await managerCtx.close();
    await internCtx.close();
  });

  test("double-clicking a one-shot action does not create duplicates (duplicate/repeated action)", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Blockers").click();
    const desc = `Double submit blocker ${Date.now()}`;
    await page.getByPlaceholder(/Describe what's blocking you/).fill(desc);
    const raiseBtn = page.getByRole("button", { name: "Raise blocker" });
    // The field clears after the first click, disabling the button (empty
    // description) — the second click is a no-op on a disabled button, not
    // a second submission.
    await raiseBtn.click();
    await expect(raiseBtn).toBeDisabled();
    await expect(page.getByText(desc)).toHaveCount(1);
  });

  test("browser refresh mid-session reconnects cleanly to current state (no stale/duplicated data)", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Board").click();
    const title = `Refresh task ${Date.now()}`;
    await page.getByRole("button", { name: "+ New task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText(title)).toBeVisible();

    await page.reload();
    await waitForSocketOpen(page);
    await tabButton(page, "Board").click();
    await expect(page.getByText(title)).toHaveCount(1); // exactly one, not duplicated by the reconnect
  });

  test("switching workspaces mid-flight does not leak the old workspace's events into the new view", async ({ page }) => {
    // Alice (intern) is a member of both "demo" and "payments" — create a
    // task in "demo", switch to "payments", and confirm it never appears
    // there; switching back confirms it's still isolated to "demo".
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    const demoOnlyTitle = `Only-in-demo task ${Date.now()}`;
    await tabButton(page, "Board").click();
    await page.getByRole("button", { name: "+ New task" }).click();
    await page.getByLabel("Title").fill(demoOnlyTitle);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText(demoOnlyTitle)).toBeVisible();

    await page.goto("/#/demo/w/payments");
    await waitForSocketOpen(page);
    await tabButton(page, "Board").click();
    await expect(page.getByText(demoOnlyTitle)).toHaveCount(0);

    await page.goto("/#/demo/w/demo");
    await waitForSocketOpen(page);
    await tabButton(page, "Board").click();
    await expect(page.getByText(demoOnlyTitle)).toBeVisible();
  });

  test("unauthorized workspace navigation shows the access-denied state, not a crash or blank page", async ({ page }) => {
    await gotoAsDemoUser(page, "intern", "#/demo/w/rahul-ml"); // Alice is not a member of rahul-ml
    await expect(page.getByText("You don't have access to this workspace")).toBeVisible();
  });

  test("a role attempting an action outside its permissions never sees the control at all", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "manager", "demo");
    await tabButton(page, "Board").click();
    await expect(page.getByRole("button", { name: "+ New task" })).toHaveCount(0);
    await tabButton(page, "Blockers").click();
    await expect(page.getByPlaceholder(/Describe what's blocking you/)).toHaveCount(0);
  });

  test("resolve is blocked without a required resolution note", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    const desc = `Note-required blocker ${Date.now()}`;
    await tabButton(page, "Blockers").click();
    await page.getByPlaceholder(/Describe what's blocking you/).fill(desc);
    await page.getByRole("button", { name: "Raise blocker" }).click();

    await gotoWorkspaceAsDemoUser(page, "manager", "demo");
    await tabButton(page, "Blockers").click();
    const card = page.locator("li", { hasText: desc });
    await card.getByRole("button", { name: "Resolve" }).click();
    await expect(card.getByRole("button", { name: "Confirm resolve" })).toBeDisabled();
  });

  test("a resolved blocker no longer offers resolve/comment controls (invalid state transition prevented)", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    const desc = `Already-resolved blocker ${Date.now()}`;
    await tabButton(page, "Blockers").click();
    await page.getByPlaceholder(/Describe what's blocking you/).fill(desc);
    await page.getByRole("button", { name: "Raise blocker" }).click();

    await gotoWorkspaceAsDemoUser(page, "manager", "demo");
    await tabButton(page, "Blockers").click();
    const card = page.locator("li", { hasText: desc });
    await card.getByRole("button", { name: "Resolve" }).click();
    await card.getByPlaceholder("Resolution note (required)").fill("done");
    await card.getByRole("button", { name: "Confirm resolve" }).click();
    await expect(card).toContainText("Resolved by");
    await expect(card.getByRole("button", { name: "Resolve" })).toHaveCount(0);
    await expect(card.getByPlaceholder(/Add an update or response/)).toHaveCount(0);
  });

  test("weekly: mentor cannot request changes without feedback (double weekly action guard)", async ({ page }) => {
    // "payments" (not "demo") — weekly reports are keyed by calendar period,
    // so reusing "demo" here collides with whatever period-report every
    // other weekly test already left behind for the current week.
    await gotoWorkspaceAsDemoUser(page, "intern", "payments");
    await tabButton(page, "Weekly").click();
    // Idempotent to reruns: the current calendar period's report on this
    // workspace may already be SUBMITTED from a previous run (weekly
    // reports are keyed by period, not created fresh every time) — only
    // start/submit if it's still an editable draft.
    const startBtn = page.getByRole("button", { name: "Start weekly review" });
    if (await startBtn.isVisible()) await startBtn.click();
    const submitBtn = page.getByRole("button", { name: "Submit for review" });
    if ((await submitBtn.count()) > 0) {
      await submitBtn.click();
      // The editable Submit button itself disappears once status leaves
      // DRAFT/CHANGES_REQUESTED — unambiguous, unlike searching the whole
      // page for "SUBMITTED", which could match an unrelated report.
      // Switching identity before this resolves would abort the in-flight
      // request and leave the mentor looking at a stale DRAFT.
      await expect(submitBtn).toHaveCount(0);
    }

    await gotoWorkspaceAsDemoUser(page, "mentor", "payments");
    await tabButton(page, "Weekly").click();
    await expect(page.getByRole("button", { name: "Request changes" })).toBeDisabled();
  });

  test("long text, empty text, and unusual names render without breaking the layout", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Blockers").click();
    // Unique marker up front — reruns against the same persisted local demo
    // workspace would otherwise create several near-identical "LLLL…" blocks
    // whose shared 40-char prefix collides in a getByText lookup.
    const longDesc = `long-text-case-${Date.now()}-` + "L".repeat(500);
    await page.getByPlaceholder(/Describe what's blocking you/).fill(longDesc);
    const raiseBtn = page.getByRole("button", { name: "Raise blocker" });
    await expect(raiseBtn).toBeEnabled();
    await raiseBtn.click();
    await expect(page.getByText(longDesc.slice(0, 40))).toBeVisible();

    // Empty text: the raise button stays disabled, no blank blocker is created.
    await expect(page.getByPlaceholder(/Describe what's blocking you/)).toHaveValue("");
    await expect(raiseBtn).toBeDisabled();

    // Unusual name: emoji/punctuation in a feedback comment.
    await gotoWorkspaceAsDemoUser(page, "mentor", "demo");
    await tabButton(page, "Feedback").click();
    const weirdText = `Great work 🎉 — “quotes” & <tags> ${Date.now()}`;
    await page.getByPlaceholder(/Feedback on progress/).fill(weirdText);
    await page.getByRole("button", { name: "Post feedback" }).click();
    await expect(page.getByText(weirdText)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
  });

  test("overdue and URGENT-overdue tasks are visually flagged", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Board").click();
    const title = `Stale URGENT task ${Date.now()}`; // avoid the word "overdue" colliding with the badge text
    await page.getByRole("button", { name: "+ New task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Priority").selectOption("URGENT");
    await page.getByLabel("Due date").fill("2000-01-01"); // guaranteed in the past
    await page.getByRole("button", { name: "Create", exact: true }).click();

    const card = page.locator("article", { hasText: title });
    await expect(card).toBeVisible();
    await expect(card.getByText(/overdue/i)).toBeVisible();
    await expect(card.getByText("URGENT", { exact: true })).toBeVisible();
  });
});
