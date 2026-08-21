import { admin, userIdByEmail } from "./db"
import { readSavedModes, clearSavedModes } from "./saved-modes"

/**
 * Puts back what the run switched off.
 *
 * `auth.setup.ts` forces both accounts to `today_screen_mode = 'never'`,
 * because an unfinished day would otherwise divert every `goto("/dashboard")`
 * in three spec files. That is right for the run and wrong to leave behind:
 * these are the accounts used for manual testing, and a suite that silently
 * disables a feature you are trying to look at is a suite that costs you an
 * afternoon.
 *
 * **A teardown rather than an `afterAll`.** The opt-out is global, so undoing
 * it belongs at the same scope; an `afterAll` in one spec would restore it
 * while later files were still running.
 *
 * Records nothing itself: `auth.setup.ts` writes the previous values, so a run
 * that never reached setup has nothing to put back and this is a no-op.
 */
export default async function globalTeardown() {
  const saved = readSavedModes()
  if (!Object.keys(saved).length) return

  for (const [email, mode] of Object.entries(saved)) {
    const { error } = await admin
      .from("users")
      .update({ today_screen_mode: mode })
      .eq("id", await userIdByEmail(email))
    if (error) throw error
  }

  clearSavedModes()
}
