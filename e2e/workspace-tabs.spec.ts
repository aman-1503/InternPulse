import { test, expect } from "@playwright/test";
import { gotoAsDemoUser, gotoWorkspaceAsDemoUser, tabButton } from "./fixtures";

test.describe("workspace tabs (demo workspace)", () => {
  test("all tabs are reachable and show distinct content", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "manager", "demo");

    await tabButton(page, "Board").click();
    await expect(page.getByRole("button", { name: "+ New task" })).toHaveCount(0); // manager can't create
    await expect(page.getByText("To do")).toBeVisible();

    await tabButton(page, "Blockers").click();
    await expect(page.getByRole("heading", { name: /Open \(/ })).toBeVisible();

    await tabButton(page, "Feedback").click();
    await expect(page.getByRole("heading", { name: "Add feedback" })).toBeVisible();

    await tabButton(page, "Activity").click();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();

    await tabButton(page, "Weekly").click();
    await expect(page.getByText(/report\(s\)/)).toBeVisible();

    await tabButton(page, "Agent").click();
    await expect(page.getByRole("heading", { name: "Progress Agent" })).toBeVisible();

    await tabButton(page, "Attachments").click();
    await expect(page.getByRole("heading", { name: "Attachments" })).toBeVisible();

    await tabButton(page, "Overview").click();
    await expect(page.getByRole("heading", { name: "Needs escalation" })).toBeVisible(); // manager lens
  });

  test("board: intern can create a task and it appears in To do", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Board").click();

    const title = `E2E task ${Date.now()}`;
    await page.getByRole("button", { name: "+ New task" }).click();
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.getByText(title)).toBeVisible();
  });

  test("board: mentor sees priority-only control, not full edit, on the intern's task", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "mentor", "demo");
    await tabButton(page, "Board").click();
    await expect(page.getByText("You can change task priority but not rewrite the intern's task status.")).toBeVisible();
  });

  test("blockers: only the intern sees the raise-a-blocker form", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Blockers").click();
    await expect(page.getByPlaceholder(/Describe what's blocking you/)).toBeVisible();

    await gotoWorkspaceAsDemoUser(page, "mentor", "demo");
    await tabButton(page, "Blockers").click();
    await expect(page.getByText("Only the intern can raise a new blocker")).toBeVisible();
  });

  test("blockers: intern raises one, it shows up as open", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Blockers").click();
    const description = `E2E blocker ${Date.now()}`;
    await page.getByPlaceholder(/Describe what's blocking you/).fill(description);
    await page.getByRole("button", { name: "Raise blocker" }).click();
    await expect(page.getByText(description)).toBeVisible();
  });

  test("feedback: mentor can post, intern cannot", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Feedback").click();
    await expect(page.getByText("Only a mentor or manager can give feedback.")).toBeVisible();

    await gotoWorkspaceAsDemoUser(page, "mentor", "demo");
    await tabButton(page, "Feedback").click();
    const feedback = `E2E feedback ${Date.now()}`;
    await page.getByPlaceholder(/Feedback on progress/).fill(feedback);
    await page.getByRole("button", { name: "Post feedback" }).click();
    await expect(page.getByText(feedback)).toBeVisible();
  });

  test("weekly: intern can start a review and the lifecycle stepper renders", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Weekly").click();
    await page.getByRole("button", { name: "Start weekly review" }).click();
    // The new report's pill is selected by default; its panel shows the
    // editable draft controls immediately (state is DRAFT).
    await expect(page.getByRole("button", { name: "Submit for review" })).toBeVisible();
  });

  test("agent: quick prompt produces a grounded (fake-AI stub) answer", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Agent").click();
    await expect(page.getByRole("heading", { name: "Progress Agent" })).toBeVisible();

    const turnsBefore = await page.locator(".bg-accent", { hasText: "Summarize current progress" }).count();
    await page.getByRole("button", { name: "Summarize current progress" }).click();
    // The prompt is echoed as a new chat bubble (distinct from the
    // quick-prompt button, which stays on screen too), and AGENT_FAKE_AI=1
    // locally returns a deterministic, non-empty grounded stub as the reply.
    await expect(page.locator(".bg-accent", { hasText: "Summarize current progress" })).toHaveCount(turnsBefore + 1);
    await expect(page.getByText(/grounded on/i)).toBeVisible({ timeout: 10_000 });
  });

  test("agent: fresh workspace shows the empty state explaining what it can help with", async ({ page }) => {
    // "demo" accumulates agent conversation history across every test run,
    // so its empty state can't be asserted reliably — "payments" (also
    // seeded with Alice/Mia/Jordan) is only mutated by the mentions spec's
    // duplicate-member test, never by an agent conversation.
    await gotoWorkspaceAsDemoUser(page, "mentor", "payments");
    await tabButton(page, "Agent").click();
    await expect(page.getByText("Ask the Progress Agent anything about this workspace")).toBeVisible();
  });

  test("attachments: empty/upload state for a role that can write, read-only note for one that can't", async ({ page }) => {
    await gotoWorkspaceAsDemoUser(page, "manager", "demo");
    await tabButton(page, "Attachments").click();
    await expect(page.getByText("Your role can view and download files but not upload.")).toBeVisible();

    await gotoWorkspaceAsDemoUser(page, "intern", "demo");
    await tabButton(page, "Attachments").click();
    await expect(page.getByText(/Drop a file here, or click to browse/)).toBeVisible();
  });

  test("loading state: workspace shows a loading screen before the socket opens", async ({ page }) => {
    // gotoAsDemoUser (unlike gotoWorkspaceAsDemoUser) doesn't wait for the
    // socket to open, so the interstitial is what we should see right away.
    await gotoAsDemoUser(page, "intern", "#/demo/w/demo");
    await expect(page.getByText("Loading workspace…")).toBeVisible();
  });

  test("unauthorized state: a non-member id shows the access-denied empty state", async ({ page }) => {
    await gotoAsDemoUser(page, "intern", "#/demo/w/does-not-exist");
    await expect(page.getByText("You don't have access to this workspace")).toBeVisible();
    await expect(page.getByRole("button", { name: "← Back" })).toBeVisible();
  });
});
