import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import { admin, requireEnv, sessionFor, userIdByEmail } from "./db"
import { storageStateFor } from "./session"

/**
 * Step 15. `/profile` and `/profile/[username]`.
 *
 * **Every case here is drawn from something this project has already got
 * wrong**, or from a rule that fails silently rather than loudly:
 *
 * | Case | Where it comes from |
 * |---|---|
 * | Username is the heading, display name the subtitle | `display_name` is **not unique**; the roster once rendered two identical rows for two people |
 * | `RYAHN2` finds `ryahn2` | The unique index is on `lower(username)`; a plain `=` is a scan *and* a miss |
 * | Blocked and nonexistent are the same 404 | A distinguishable answer makes "did they block me" probeable |
 * | Hidden stats are not zeroes | Zero is true of a new account and false of someone withholding |
 * | Your own stats show with the toggle off | `user_lifetime_stats_select_visible`'s first clause, mirrored in the RPC |
 * | Signed out is a redirect, not a page | `PUBLIC_PREFIXES` is deny-by-default, and step 14 found two routes wrongly *outside* it |
 * | `anon` cannot execute the RPC | `SECURITY DEFINER` runs as the owner: a forgotten revoke publishes every profile |
 * | Profile is highlighted on `/profile` and not on `/profile/x` | The `exact` flag, which nothing else in `sections.ts` needs |
 *
 * **Writes** nothing permanently. Two rows are touched — `visible_on_profile`
 * and one `user_blocks` row — and both are restored.
 */

const OWNER = () => requireEnv("E2E_OWNER_EMAIL")
const JOINER = () => requireEnv("E2E_JOINER_EMAIL")

async function usernameOf(userId: string): Promise<string> {
  const { data, error } = await admin
    .from("users")
    .select("username")
    .eq("id", userId)
    .single()
  if (error) throw error
  if (!data.username) throw new Error(`${userId} has no username`)
  return data.username
}

async function statsVisibility(userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("user_lifetime_stats")
    .select("visible_on_profile")
    .eq("user_id", userId)
    .single()
  if (error) throw error
  return data.visible_on_profile
}

async function setStatsVisibility(userId: string, visible: boolean) {
  const { error } = await admin
    .from("user_lifetime_stats")
    .update({ visible_on_profile: visible })
    .eq("user_id", userId)
  if (error) throw error
}

test("your own profile is the Profile tab, and shows your stats either way", async ({
  browser,
}) => {
  const ownerId = await userIdByEmail(OWNER())
  const username = await usernameOf(ownerId)
  const wasVisible = await statsVisibility(ownerId)

  const context = await browser.newContext({
    storageState: await storageStateFor(OWNER()),
  })
  const page = await context.newPage()

  try {
    // **Toggle off, deliberately.** Your own stats come back regardless — the
    // RPC mirrors `user_lifetime_stats_select_visible`, whose first clause is
    // `user_id = auth.uid()`. If that clause were dropped, the owner would see
    // "hasn't shared their stats" on their own page, which reads as a bug in
    // the toggle rather than in the query.
    await setStatsVisibility(ownerId, false)

    await page.goto("/profile")
    const profile = page.getByRole("region", { name: `${username}'s profile` })
    await expect(profile).toBeVisible()

    // **The username is the heading.** `display_name` is not unique, and this
    // page's whole job is to say who somebody is.
    await expect(profile.getByRole("heading", { name: username })).toBeVisible()

    await expect(
      profile.getByText(/hasn't shared their stats/),
      "your own stats were withheld from you",
    ).toHaveCount(0)
    await expect(profile.getByText("Current streak")).toBeVisible()
    await expect(profile.getByText("Goals achieved")).toBeVisible()

    // Joined, formatted UTC-pinned. Asserted by shape rather than by value: a
    // fixed month would rot, and formatting it in the viewer's zone is what
    // would date somebody's join a day early west of UTC.
    await expect(profile.getByText(/Joined [A-Z][a-z]+ \d{4}/)).toBeVisible()

    // The tab is highlighted, which is the `exact` flag's positive case.
    await expect(
      page.getByRole("link", { name: "Profile" }),
    ).toHaveAttribute("aria-current", "page")
  } finally {
    await setStatsVisibility(ownerId, wasVisible)
    await context.close()
  }
})

test("your own username redirects to /profile, and the tab bar survives it", async ({
  browser,
}) => {
  const ownerId = await userIdByEmail(OWNER())
  const username = await usernameOf(ownerId)

  const context = await browser.newContext({
    storageState: await storageStateFor(OWNER()),
  })
  const page = await context.newPage()

  try {
    await page.goto("/dashboard")

    // **The structural claim of the `(shell)` move**, asserted by identity
    // rather than by appearance: `/profile` is a sibling of `/dashboard` under
    // one layout, so navigating between them must not rebuild the bar. "It is
    // still visible" would pass just as happily on a bar that was torn down.
    const bar = page.getByRole("navigation").first()
    await bar.evaluate((node) => {
      ;(node as HTMLElement & { __solarity?: string }).__solarity = "same-node"
    })

    await page.getByRole("link", { name: "Profile" }).click()
    await expect(page).toHaveURL(/\/profile$/)

    expect(
      await bar.evaluate(
        (node) => (node as HTMLElement & { __solarity?: string }).__solarity,
      ),
      "the bar was re-mounted moving from /dashboard to /profile",
    ).toBe("same-node")

    // One canonical URL for your own profile.
    await page.goto(`/profile/${username}`)
    await expect(page, "your own username did not redirect").toHaveURL(/\/profile$/)

    // And case does not change that: the redirect is decided by the RPC's
    // `is_self`, not by comparing strings.
    await page.goto(`/profile/${username.toUpperCase()}`)
    await expect(page).toHaveURL(/\/profile$/)
  } finally {
    await context.close()
  }
})

test("someone else's profile: case-insensitive, no tab highlight, stats opt-in", async ({
  browser,
}) => {
  const joinerId = await userIdByEmail(JOINER())
  const joiner = await usernameOf(joinerId)
  const wasVisible = await statsVisibility(joinerId)

  const context = await browser.newContext({
    storageState: await storageStateFor(OWNER()),
  })
  const page = await context.newPage()

  try {
    // ------------------------------------------------------ stats withheld
    await setStatsVisibility(joinerId, false)
    await page.goto(`/profile/${joiner}`)

    const profile = page.getByRole("region", { name: `${joiner}'s profile` })
    await expect(profile).toBeVisible()

    // **Not four zeroes.** Zero is a true statement about a new account and a
    // false one about somebody who has not shared.
    await expect(profile.getByText(/hasn't shared their stats/)).toBeVisible()
    await expect(profile.getByText("Current streak")).toHaveCount(0)

    // **The `exact` flag's negative case, and the reason it exists.** This is
    // somebody else's profile, so your Profile tab must not read as selected.
    await expect(
      page.getByRole("link", { name: "Profile" }),
      "the Profile tab was highlighted on someone else's profile",
    ).not.toHaveAttribute("aria-current", "page")

    // -------------------------------------------------------- stats shared
    await setStatsVisibility(joinerId, true)
    await page.reload()
    await expect(profile.getByText("Longest streak")).toBeVisible()
    await expect(profile.getByText(/hasn't shared their stats/)).toHaveCount(0)

    // ------------------------------------------------- case-insensitivity
    // The unique index is on `lower(username)`. A plain `=` would both miss
    // this and stop using the index.
    await page.goto(`/profile/${joiner.toUpperCase()}`)
    await expect(
      page.getByRole("region", { name: `${joiner}'s profile` }),
      "an uppercased username did not resolve",
    ).toBeVisible()
  } finally {
    await setStatsVisibility(joinerId, wasVisible)
    await context.close()
  }
})

test("a blocked profile is indistinguishable from one that does not exist", async ({
  browser,
}) => {
  const ownerId = await userIdByEmail(OWNER())
  const joinerId = await userIdByEmail(JOINER())
  const joiner = await usernameOf(joinerId)

  const context = await browser.newContext({
    storageState: await storageStateFor(OWNER()),
  })
  const page = await context.newPage()

  /**
   * What the browser can tell about a username, as a comparable pair.
   *
   * **Not the HTTP status**, which is what this test asserted first and why it
   * failed. `notFound()` can only set a 404 while the response headers are
   * still unsent, and these routes stream: `(shell)/loading.tsx` gives them a
   * Suspense boundary, so the shell is flushed with a 200 before the page has
   * finished deciding. The not-found UI then arrives inside a response that
   * already committed.
   *
   * That is a test problem rather than a product one — `/profile` is behind
   * auth, so no crawler ever sees the status — and the property under test was
   * never really about the number. It is that **the two answers are the same**,
   * so comparing them to each other is both closer to the claim and immune to
   * how Next chooses to stream.
   */
  const look = async (username: string) => {
    const response = await page.goto(`/profile/${username}`)
    return {
      status: response?.status(),
      showsProfile: await page
        .getByRole("region", { name: new RegExp(`${username}'s profile`, "i") })
        .isVisible()
        .catch(() => false),
    }
  }

  try {
    // A username nobody has, for comparison.
    const missing = await look("__no_such_person__")
    expect(missing.showsProfile, "a nonexistent username rendered a profile").toBe(
      false,
    )

    // **The block is inserted in the direction the one-argument helper cannot
    // see.** `private.is_blocked_by(x)` answers "has x blocked me", so a
    // profile hidden because *you* blocked *them* is the case an implementation
    // reusing that helper would miss. This is that case.
    const { error } = await admin
      .from("user_blocks")
      .insert({ blocker_user_id: ownerId, blocked_user_id: joinerId })
    expect(error, "could not seed the block").toBeNull()

    const blocked = await look(joiner)

    expect(blocked.showsProfile, "a blocked profile was still rendered").toBe(false)

    // **The assertion this test exists for.** Not "it 404s" but "it answers
    // exactly as a username nobody has answers". Anything that separates the
    // two makes "did they block me" something anyone can probe.
    expect(
      blocked,
      "a blocked profile answered differently from a missing one",
    ).toEqual(missing)
  } finally {
    await admin
      .from("user_blocks")
      .delete()
      .eq("blocker_user_id", ownerId)
      .eq("blocked_user_id", joinerId)
    await context.close()
  }
})

test("a profile is not reachable signed out", async ({ browser }) => {
  const joiner = await usernameOf(await userIdByEmail(JOINER()))

  // No storage state: a visitor with no session.
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    // `PUBLIC_PREFIXES` is deny-by-default and `/profile` is deliberately not
    // on it. Step 14 found two routes that were wrongly *outside* the list;
    // this is the assertion for a route that must stay inside it.
    await page.goto(`/profile/${joiner}`)
    await expect(page).toHaveURL(/\/auth\/sign-in/)
  } finally {
    await context.close()
  }
})

/**
 * The grants, which only a real client can prove.
 *
 * Migration 86's own proof runs as the table owner, where `revoke execute` does
 * not apply. **A `SECURITY DEFINER` function reachable by `anon` publishes every
 * profile to the open internet**, so the revoke is the single most consequential
 * line in that file and the one a proof running as the owner cannot check.
 */
test("the RPC is callable by a signed-in user and not by anon", async () => {
  const joiner = await usernameOf(await userIdByEmail(JOINER()))
  const owner = await sessionFor(OWNER())

  const asOwner = await owner.rpc("profile_by_username", { p_username: joiner })
  expect(asOwner.error, "a signed-in user could not read a profile").toBeNull()
  expect(asOwner.data, "the RPC returned no profile for a real username").toHaveLength(1)

  const anon = createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const asAnon = await anon.rpc("profile_by_username", { p_username: joiner })
  expect(asAnon.error, "anon was allowed to execute profile_by_username").not.toBeNull()
  expect(asAnon.error?.code, "the refusal was not a permission error").toBe("42501")
})
