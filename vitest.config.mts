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

    /**
     * **`node`, not `jsdom`, and it is worth knowing why.**
     *
     * Not one unit test in this project touches the DOM. They cover error
     * hints, push copy, digest grouping, the CSP and violation-report parsing —
     * all pure functions. `jsdom` was here from the scaffold, on the assumption
     * that component tests would follow. They did not: anything needing a real
     * browser is a Playwright spec, because that is where a real browser is.
     *
     * It stopped being free. `jsdom` 30 pulls in `undici`, which calls
     * `webidl.util.markAsUncloneable` — a Node API newer than the runtime CI
     * was pinned to. Every one of the five test files failed to start, none of
     * them ran, and the error named `cachestorage.js` rather than anything in
     * this repository. **A dependency the tests do not use should not be able
     * to stop them running.**
     *
     * If a component test is ever written, it opts in per file with
     * `// @vitest-environment jsdom` at the top, and brings its own matchers.
     */
    environment: "node",
    globals: true,
    passWithNoTests: true,
    // Vitest's default `include` is **/*.{test,spec}.ts, which would collect
    // the Playwright specs and fail on the first `@playwright/test` import.
    // The two runners share a naming convention, so the split is by directory.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@": rootDir,

      /**
       * **`server-only` throws by design when imported outside a React Server
       * Component**, which is the whole point of the package: it is a build-time
       * tripwire, and its `default` export is a module that raises.
       *
       * A node test runner is neither a server component nor a client bundle, so
       * without this every unit test of a `lib/supabase/*` module would fail on
       * the import line for a reason that has nothing to do with the module.
       * Stubbed to nothing here; the tripwire still works everywhere it means
       * something, because Next resolves the real package.
       */
      "server-only": path.resolve(rootDir, "vitest.server-only-stub.ts"),
    },
  },
});
