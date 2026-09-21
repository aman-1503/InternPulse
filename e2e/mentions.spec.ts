import { test, expect } from "@playwright/test";
import { gotoWorkspaceAsDemoUser, tabButton } from "./fixtures";

/** All mention interactions here go through the Blockers "describe what's
 * blocking you" textarea (intern-only), which is the simplest single-field
 * mention host in the app and exercises the exact same useMentionSuggestions
 * hook every other composer uses. */
async function openBlockerComposer(page: import("@playwright/test").Page) {
  await gotoWorkspaceAsDemoUser(page, "intern", "demo");
  await tabButton(page, "Blockers").click();
  return page.getByPlaceholder(/Describe what's blocking you/);
}

/** The demo workspace's task-link <select> also has (many) native <option>
 * elements, which share the accessible role "option" — always scope to the
 * mention popup's listbox specifically, never query "option" page-wide. */
function mentionOptions(page: import("@playwright/test").Page) {
  return page.getByRole("listbox").getByRole("option");
}

test.describe("@mention autocomplete", () => {
  test("@ opens suggestions listing workspace members", async ({ page }) => {
    const field = await openBlockerComposer(page);
    await field.pressSequentially("@");
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(mentionOptions(page)).toHaveCount(3); // Alice, Mia, Jordan
  });

  test("typing after @ filters the candidate list", async ({ page }) => {
    const field = await openBlockerComposer(page);
    await field.pressSequentially("@j");
    await expect(mentionOptions(page)).toHaveCount(1);
    await expect(mentionOptions(page)).toContainText("Jordan Park");
  });

  test("ArrowDown/ArrowUp move the highlighted suggestion", async ({ page }) => {
    const field = await openBlockerComposer(page);
    await field.pressSequentially("@");
    await expect(mentionOptions(page)).toHaveCount(3);

    const activeName = () => page.locator("[data-mention-active]").innerText();
    const first = await activeName();

    await field.press("ArrowDown");
    const second = await activeName();
    expect(second).not.toEqual(first);

    await field.press("ArrowUp");
    const backToFirst = await activeName();
    expect(backToFirst).toEqual(first);
  });

  test("Enter selects the highlighted suggestion and inserts @Display Name", async ({ page }) => {
    const field = await openBlockerComposer(page);
    await field.pressSequentially("@j"); // narrows to Jordan Park alone
    await field.press("Enter");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(field).toHaveValue("@Jordan Park ");
  });

  test("Tab selects the highlighted suggestion", async ({ page }) => {
    const field = await openBlockerComposer(page);
    await field.pressSequentially("@mi");
    await field.press("Tab");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(field).toHaveValue("@Mia Rivera ");
  });

  test("Escape closes suggestions without inserting anything", async ({ page }) => {
    const field = await openBlockerComposer(page);
    await field.pressSequentially("@al");
    await field.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(field).toHaveValue("@al");
  });

  test("mouse click selects a suggestion", async ({ page }) => {
    const field = await openBlockerComposer(page);
    await field.pressSequentially("@");
    await mentionOptions(page).filter({ hasText: "Mia Rivera" }).click();
    await expect(field).toHaveValue("@Mia Rivera ");
  });

  test("multiple mentions can be inserted in one message", async ({ page }) => {
    const field = await openBlockerComposer(page);
    await field.pressSequentially("@al");
    await field.press("Enter");
    await field.pressSequentially("and @mi");
    await field.press("Enter");
    await expect(field).toHaveValue("@Alice Chen and @Mia Rivera ");
  });

  test("a mention typed in the middle of existing text inserts inline, not at the end", async ({ page }) => {
    const field = await openBlockerComposer(page);
    await field.pressSequentially("hello world");
    // Move the caret to just after "hello " (index 6) and mention there.
    await field.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6));
    await field.pressSequentially("@jo");
    await field.press("Enter");
    await expect(field).toHaveValue("hello @Jordan Park world");
  });

  test("non-member text (no match) is left as plain text, not treated as a mention", async ({ page }) => {
    const field = await openBlockerComposer(page);
    await field.pressSequentially("@nobody-like-this");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(field).toHaveValue("@nobody-like-this");
  });

  test("duplicate display names both appear as distinct, separately-selectable options", async ({ page }) => {
    // Use "payments" (also seeded with Alice/Mia/Jordan) so this doesn't
    // pollute the "demo" workspace other specs assert against.
    await gotoWorkspaceAsDemoUser(page, "mentor", "payments");
    const membersBtn = page.getByRole("button", { name: /^Members/ });
    await membersBtn.click();
    await page.getByPlaceholder("Name").fill("Alice Chen");
    await page.getByPlaceholder("Email").fill(`alice.dup.${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Add member" }).click();
    await expect(page.getByText("Adding…")).toHaveCount(0, { timeout: 10_000 });
    await page.keyboard.press("Escape");

    await tabButton(page, "Feedback").click();
    const feedbackField = page.getByPlaceholder(/Feedback on progress/);
    await feedbackField.pressSequentially("@Alice");
    // >= 2, not exactly 2: rerunning this spec against a persisted local
    // demo workspace adds another duplicate member each time (see comment
    // above) — the point is duplicates coexist as distinct options, not a
    // specific count.
    const count = await mentionOptions(page).filter({ hasText: "Alice Chen" }).count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
