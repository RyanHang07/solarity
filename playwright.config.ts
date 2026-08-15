import { defineConfig, devices } from "@playwright/test"
import { loadEnvLocal } from "./e2e/env"

// Playwright's runner loads no env files of its own, so this has to happen
// before the config below reads `E2E_BASE_URL`. Workers re-import this file,
// which is what makes the variables visible inside the specs too.
loadEnvLocal()

/**
 * End-to-end tests. Separate from Vitest, which owns unit tests under the
 * `test` script and is told to ignore `e2e/` so the two do not collect each
 * other's files.
 *
 * **These run against a real Supabase project**, not a local one. There is no
 * `supabase/config.toml` and no local stack, so a test that writes leaves rows
 * behind: every spec cleans up after itself and names its data `E2E …` so a
 * stray row is obvious in the dashboard.
 */
export default defineConfig({
  testDir: "./e2e",
  // Serial by default. The specs create and archive Circles owned by the same
  // two real accounts, and the 5-a-day Circle creation limit is per user, so
  // parallel workers would race each other into a rate limit rather than into
  // a bug.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    // Mints storage states for both accounts. Everything else depends on it.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],

  /**
   * Reuses a dev server you already have running, which is the normal case
   * while working. Starts one otherwise.
   *
   * **`E2E_PROD=1` runs against a production build instead**, and it is worth
   * reaching for when a failure looks like infrastructure rather than
   * behaviour. `npm run dev` streams responses and recompiles routes on first
   * visit, so a server action can be interrupted mid-flight and surface as
   * "The destination stream closed early" in the server log, with a button
   * stuck on its pending label in the browser. That symptom does not exist in
   * a production build.
   *
   * The rule of thumb: a test that fails under `dev` and passes under
   * `E2E_PROD=1` found a dev-server artefact. One that fails under both found a
   * bug.
   */
  webServer: {
    command: process.env.E2E_PROD ? "npm run build && npm run start" : "npm run dev",
    url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    // A production build has to be built, and reusing a stale dev server would
    // defeat the point of asking for one.
    reuseExistingServer: !process.env.CI && !process.env.E2E_PROD,
    timeout: process.env.E2E_PROD ? 300_000 : 120_000,
  },
})
