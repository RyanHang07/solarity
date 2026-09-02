import { test as setup, expect } from "@playwright/test"
import { createServerClient } from "@supabase/ssr"
import fs from "node:fs"
import { AUTH_DIR, statePath, type E2EAccount } from "./auth-state"
import { admin, requireEnv, userIdByEmail } from "./db"
import { saveModes, type TodayMode } from "./saved-modes"
import { TERMS_VERSION } from "@/lib/legal"

/**
 * Signs all three test accounts in without touching Google.
 *
 * **The problem.** Solarity is Google OAuth only. Playwright cannot drive
 * Google's consent screen, and automating it would be testing Google rather
 * than Solarity.
 *
 * **The approach.** Ask the admin API for a magic-link token, redeem it with an
 * ordinary anon client, and let `@supabase/ssr` write the session into cookies.
 * Those cookies become a Playwright storage state.
 *
 * **Why the cookies are built by `createServerClient` rather than by hand.**
 * The session cookie is base64-prefixed, URI-encoded and chunked at 3180
 * characters, and all three are `@supabase/ssr` implementation details that
 * have changed before. Handing it a cookie adapter that records instead of
 * writing means the library produces exactly what the app will later read, and
 * an upgrade that changes the format changes both sides at once.
 *
 * No user is modified. No password is set. Nothing here exists in production.
 */

/**
 * Both accounts opt out of the `/today` diversion for the whole run.
 *
 * **Otherwise step 9b's gate breaks most of the suite.** Neither test account
 * finishes its goals, so every `goto("/dashboard")` in `invite`, `roster` and
 * `dashboard` would be redirected to `/today` and every assertion after it
 * would fail somewhere that never mentions check-ins. Same shape as moving the
 * Circles list in 8f-1, one layer wider.
 *
 * `gates.spec.ts` sets the mode it needs per test and puts it back to `never`,
 * so the file that tests the gate is the only one that sees it.
 */
const ACCOUNTS: Record<E2EAccount, string> = {
  owner: requireEnv("E2E_OWNER_EMAIL"),
  joiner: requireEnv("E2E_JOINER_EMAIL"),
  /**
   * **Already a site admin, and this file does not make it one.**
   *
   * `users.role` is in no client grant; it is set by SQL. So the suite cannot
   * mint an admin, and it should not try — a spec that promoted an account and
   * demoted it afterwards would be asserting against a role it had just
   * invented, and would break the moment a real admin existed.
   *
   * `admin.spec.ts` asserts this account *is* an admin before it relies on it,
   * so a missing grant fails with a sentence rather than as a puzzling 404.
   */
  admin: requireEnv("E2E_ADMIN_EMAIL"),
}

async function sessionCookiesFor(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (error) throw new Error(`generateLink failed for ${email}: ${error.message}`)

  const tokenHash = data.properties?.hashed_token
  if (!tokenHash) throw new Error(`No hashed_token returned for ${email}`)

  // Keyed by name: `setAll` can be called more than once, and a later write
  // supersedes an earlier one rather than adding to it.
  const jar = new Map<string, string>()

  const client = createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll: () =>
          [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (list) => {
          for (const { name, value } of list) jar.set(name, value)
        },
      },
    },
  )

  // `type: "email"` is what a magic link redeems as. Succeeding here is the
  // whole assertion: it proves the token was minted for a real user.
  const { error: verifyError } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  })
  if (verifyError) {
    throw new Error(`verifyOtp failed for ${email}: ${verifyError.message}`)
  }

  return [...jar.entries()].map(([name, value]) => ({
    name,
    value,
    domain: "localhost",
    path: "/",
    // Session cookies. The access token expires long before any run does.
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }))
}

/**
 * Both accounts opt out of the `/today` diversion for the whole run.
 *
 * **Otherwise step 9b's gate breaks most of the suite.** Neither test account
 * finishes its goals, so every `goto("/dashboard")` in `invite`, `roster` and
 * `dashboard` would be redirected to `/today`, and the assertion after it would
 * fail somewhere that never mentions check-ins. Same shape as moving the
 * Circles list in 8f-1, one layer wider.
 *
 * `gates.spec.ts` sets whichever mode it needs per test and puts it back to
 * `never`, so the file that tests the gate is the only one that meets it.
 */
setup("opt both accounts out of the /today gate", async () => {
  const previous: Record<string, TodayMode> = {}

  for (const email of Object.values(ACCOUNTS)) {
    const id = await userIdByEmail(email)

    // Recorded before it is changed, so `global-teardown.ts` can put it back.
    // These are the accounts used for manual testing; leaving the check-in
    // screen switched off after every run is a cost paid outside the suite.
    const { data, error: readError } = await admin
      .from("users")
      .select("today_screen_mode")
      .eq("id", id)
      .single()
    if (readError) throw readError
    previous[email] = data.today_screen_mode

    const { error } = await admin
      .from("users")
      .update({ today_screen_mode: "never" })
      .eq("id", id)
    if (error) throw error
  }

  saveModes(previous)
})

for (const [who, email] of Object.entries(ACCOUNTS)) {
  setup(`authenticate as ${who}`, async () => {
    fs.mkdirSync(AUTH_DIR, { recursive: true })
    const cookies = await sessionCookiesFor(email)

    // A session that produced no cookies is a silent failure that would show
    // up later as a confusing redirect to the sign-in page.
    expect(cookies.length, `no auth cookies produced for ${email}`).toBeGreaterThan(0)

    fs.writeFileSync(
      statePath(who as E2EAccount),
      JSON.stringify({ cookies, origins: [] }, null, 2),
    )
  })
}

/**
 * Step 20c. Gets the three fixture accounts past the terms interstitial.
 *
 * ## Why this exists
 *
 * The gate in `app/(app)/layout.tsx` sends anybody with no `terms_accepted_at`
 * to `/onboarding/terms`. All three accounts predate migration 105, so on the
 * first run after it every signed-in spec in the suite failed — ten tests
 * across four files, each reporting a missing landmark on a page that was
 * actually the terms screen. **One unmet precondition, ten unrelated-looking
 * failures**, which is the same shape as `/today` above and is why that one is
 * two paragraphs long.
 *
 * ## Why writing it directly is honest here
 *
 * The whole argument for the interstitial was that backfilling acceptance
 * writes a claim about a person's consent that nobody gave. **A fixture account
 * is not a person.** Nothing is being consented to on anyone's behalf; a
 * precondition is being met so the suite can reach the screens it tests, in the
 * same spirit as `parkActiveGoals` and `ensureUnfinishedDay`.
 *
 * **Not put back afterwards**, unlike `today_screen_mode`. Acceptance is a fact
 * that only moves forwards, and restoring null would mean the three accounts
 * used for manual testing met the interstitial after every run.
 *
 * ## What still tests the interstitial
 *
 * `sign-up.spec.ts` builds the state deliberately on a throwaway account:
 * confirm, onboard, null the columns, then meet the screen. That is the only
 * way to test it without consuming the state of an account the rest of the
 * suite depends on.
 */
setup("get the fixture accounts past the terms interstitial", async () => {
  for (const email of Object.values(ACCOUNTS)) {
    const id = await userIdByEmail(email)

    const { data, error } = await admin
      .from("users")
      .update({
        terms_accepted_at: new Date().toISOString(),
        terms_accepted_version: TERMS_VERSION,
      })
      .eq("id", id)
      .select("id")

    if (error) throw error
    // `.select("id")` is the only proof the write landed: RLS filters rather
    // than erroring, and the service key silently matching nothing would leave
    // the suite failing exactly as it did before.
    if (!data?.length) throw new Error(`terms acceptance did not apply to ${email}`)
  }
})
