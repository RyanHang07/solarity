import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
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
