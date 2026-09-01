import path from "node:path"

/**
 * Storage-state paths for the three e2e accounts.
 *
 * Kept out of `auth.setup.ts` because Playwright forbids importing one test
 * file from another. Specs need these paths; only the setup project mints them.
 *
 * **`admin` is a real, permanently promoted account**, not one the suite makes.
 * Site admin is set by SQL and by nothing else, so a spec that needed one used
 * to promote the owner and put the role back — which quietly assumed the owner
 * was the *only* admin, and stopped being true the moment a real one existed.
 * A separate account is what makes the admin tests independent of production
 * state instead of silently coupled to it.
 */

export const AUTH_DIR = path.join(process.cwd(), "e2e", ".auth")

export type E2EAccount = "owner" | "joiner" | "admin"

export function statePath(who: E2EAccount) {
  return path.join(AUTH_DIR, `${who}.json`)
}
