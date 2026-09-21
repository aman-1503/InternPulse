import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E suite — deliberately separate from Vitest (which only ever
 * runs `src/**\/*.test.ts`, fast unit/component tests against real SQL). This
 * suite drives a real browser against a real `wrangler dev --local` server.
 *
 * Every spec here exercises the DEMO experience (`#/demo/...`), never real
 * Cloudflare Access — there's no way to mint a session Access would accept
 * from an automated shell, and the codebase has no "trust this header
 * locally" bypass (see README "Local setup"). The one exception is asserting
 * that a *production* route correctly shows the "sign-in required" screen
 * when no Access identity is present — that's the real, intended local
 * behavior, not a workaround.
 *
 * Start the server yourself first (see package.json `test:e2e`):
 *   npm run db:migrate:local && npm run db:seed:local
 *   npx vite build
 *   npx wrangler dev --local --port 8787
 *   npx playwright test
 */
const PORT = process.env.INTERNPULSE_E2E_PORT || "8787";
const BASE_URL = process.env.INTERNPULSE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // demo workspace state is shared across specs/workers
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    // Full functional suite runs once, at desktop size, against a single
    // shared demo-workspace backend (state is NOT reset between specs).
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    // Other viewports only re-run the responsive/visual-QA spec — re-running
    // every mutating functional spec at 4 viewports would just pile 4x the
    // writes onto the same demo workspace for no additional signal.
    {
      name: "laptop-chromium",
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "tablet",
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices["iPad Mini"] },
    },
    {
      name: "mobile",
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
    },
  ],
});
