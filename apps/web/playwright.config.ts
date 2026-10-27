import { defineConfig, devices } from "@playwright/test";

// E2E runs the production build (`turbo run e2e` builds first) against the dev Supabase project.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  // Each reader test parses PDFs; one worker per core (28 here) starves them and times out.
  workers: isCI ? 2 : 6,
  expect: { timeout: 10_000 },
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start --port ${port}`,
    // Tests expect the production default (sign-up hidden), whatever .env.local says.
    env: { ...process.env, ALLOW_SIGNUPS: "false" },
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
