import path from "node:path"

/**
 * Storage-state paths for the two e2e accounts.
 *
 * Kept out of `auth.setup.ts` because Playwright forbids importing one test
 * file from another. Specs need these paths; only the setup project mints them.
 */

export const AUTH_DIR = path.join(process.cwd(), "e2e", ".auth")

export type E2EAccount = "owner" | "joiner"

export function statePath(who: E2EAccount) {
  return path.join(AUTH_DIR, `${who}.json`)
}
