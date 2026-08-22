import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    /**
     * **Deliberately not UTC.** Check-in dates are `YYYY-MM-DD` strings that
     * have already had a timezone applied, so parsing one locally re-applies an
     * offset and shifts the day. In a UTC runner that bug is invisible: the
     * wrong code and the right code agree. A negative offset makes the tests
     * able to fail, which is the only reason to have them.
     */
    env: { TZ: "America/Los_Angeles" },
    environment: "jsdom",
    globals: true,
    passWithNoTests: true,
    setupFiles: ["./vitest.setup.ts"],
    // Vitest's default `include` is **/*.{test,spec}.ts, which would collect
    // the Playwright specs and fail on the first `@playwright/test` import.
    // The two runners share a naming convention, so the split is by directory.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
});
