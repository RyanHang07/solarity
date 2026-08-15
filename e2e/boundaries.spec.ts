import { test, expect } from "@playwright/test"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import {
  admin,
  assertOk,
  circleName,
  clearRateLimits,
  deleteE2ECircles,
  freeGoalSlot,
  requireEnv,
  restoreGoalSlot,
  userIdByEmail,
} from "./db"

/**
 * Rules the database enforces that no screen exposes, chosen by walking the bug
 * pattern list rather than the feature list.
 *
 * **The theme is pattern five, "guarded on one path, not its inverse".** Every
 * rule here has a happy path that is already covered and an inverse that is
 * not: joining is tested, leaving is not; inserting a goal is capped, restoring
 * an archived one might not be; a revoked link is refused, an expired one is
 * assumed to be.
 *
 * All API-level and signed in as real users. A rule that only holds because the
 * UI never offers the action is not a rule.
 */

async function clientFor(email: string): Promise<SupabaseClient<Database>> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (error) throw new Error(`generateLink failed for ${email}: ${error.message}`)

  const client = createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const { error: verifyError } = await client.auth.verifyOtp({
    token_hash: data.properties!.hashed_token,
    type: "email",
  })
  if (verifyError) throw new Error(`verifyOtp failed: ${verifyError.message}`)
  return client
}

/** A Circle owned by the first account, with an invite token. */
async function circleWithLink(owner: SupabaseClient<Database>, label: string) {
  const created = await owner.rpc("create_circle", { p_name: circleName(label) })
  assertOk(created, `create_circle for ${label}`)
  const link = await owner.rpc("create_invite_link", {
    p_group_id: created.data as string,
  })
  assertOk(link, `create_invite_link for ${label}`)
  return { groupId: created.data as string, token: link.data as string }
}

/**
 * A goal that exists only for the duration of one test.
 *
 * **Tests must not borrow account state.** An earlier version of this file read
 * "one of the joiner's existing goals" and broke the moment that account had
 * none, with `Cannot coerce the result to a single JSON object` pointing at the
 * lookup rather than at the assumption. These are real accounts that get used
 * by hand, so their contents are not a fixture.
 *
 * `freeGoalSlot` first because the cap is 10 and the account may be at it;
 * `restoreGoalSlot` last, after the temporary goal is gone and the slot is free
 * again.
 */
async function withTempGoal(
  userId: string,
  title: string,
  body: (goalId: string) => Promise<void>,
) {
  const category = await admin.from("goal_categories").select("id").limit(1).single()
  assertOk(category, "read a goal category")

  const freed = await freeGoalSlot(userId)
  let goalId: string | null = null
  try {
    const created = await admin
      .from("goals")
      .insert({ user_id: userId, title, category_id: category.data.id })
      .select("id")
      .single()
    assertOk(created, `create the temporary goal "${title}"`)
    goalId = created.data.id

    await body(goalId)
  } finally {
    if (goalId) {
      await admin.from("progress_entries").delete().eq("goal_id", goalId)
      await admin.from("goals").delete().eq("id", goalId)
    }
    await restoreGoalSlot(freed)
  }
}

test.beforeAll(async () => {
  await clearRateLimits()
})
test.afterAll(async () => {
  await deleteE2ECircles()
})

test.describe("check-in dates cannot be forged", () => {
  test("a check-in cannot be backdated or postdated, even by its owner", async () => {
    // The anti-cheat guarantee the whole streak system rests on, and the one
    // place the app deliberately does not trust its own client: the INSERT
    // policy requires `check_in_date` to equal `current_checkin_date()`, so a
    // hand-crafted request cannot fabricate an unbroken streak.
    //
    // Nothing in the UI can even attempt this, which is exactly why it is worth
    // a test: the rule is invisible until someone bypasses the form.
    const joiner = await clientFor(requireEnv("E2E_JOINER_EMAIL"))
    const joinerId = await userIdByEmail(requireEnv("E2E_JOINER_EMAIL"))

    await withTempGoal(joinerId, "E2E DATE PROBE", async (goalId) => {
      const { data: today } = await joiner.rpc("current_checkin_date")
      const shift = (days: number) => {
        const d = new Date(today as string)
        d.setUTCDate(d.getUTCDate() + days)
        return d.toISOString().slice(0, 10)
      }

      // Both directions. Backdating buys a streak you did not earn; postdating
      // banks one you have not earned yet. Neither may be possible.
      for (const [label, date] of [
        ["yesterday", shift(-1)],
        ["tomorrow", shift(1)],
        ["a week ago", shift(-7)],
      ] as const) {
        const { error } = await joiner.from("progress_entries").insert({
          goal_id: goalId,
          user_id: joinerId,
          check_in_date: date,
          note: null,
        })
        expect(error, `a check-in dated ${label} was accepted`).not.toBeNull()
      }

      // Nothing was written. The assertions above only prove an error came
      // back, not that the row was rejected, and those are different claims.
      const { data: written } = await admin
        .from("progress_entries")
        .select("check_in_date")
        .eq("goal_id", goalId)
      expect(written ?? [], "a forged check-in was actually written").toEqual([])

      // And the honest one still works, so the rule is "wrong date refused"
      // rather than "inserts are broken".
      const { error: todayError } = await joiner.from("progress_entries").insert({
        goal_id: goalId,
        user_id: joinerId,
        check_in_date: today as string,
      })
      expect(todayError, "a correctly dated check-in was refused").toBeNull()
    })
  })

  test("a check-in cannot be written against someone else's goal", async () => {
    // `validate_progress_entry_owner` raises NOT_YOUR_GOAL. The interesting
    // part is that migration 64 narrowed `goals` to its owner, so the trigger's
    // own lookup now returns nothing for a foreign goal rather than a mismatched
    // owner. Both paths must still refuse, and this proves the tightening did
    // not turn a refusal into a silent success.
    const owner = await clientFor(requireEnv("E2E_OWNER_EMAIL"))
    const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
    const joinerId = await userIdByEmail(requireEnv("E2E_JOINER_EMAIL"))

    await withTempGoal(joinerId, "E2E NOT YOUR GOAL", async (goalId) => {
      const { data: today } = await owner.rpc("current_checkin_date")

      // Claiming it as your own row.
      const asSelf = await owner.from("progress_entries").insert({
        goal_id: goalId,
        user_id: ownerId,
        check_in_date: today as string,
      })
      expect(asSelf.error, "checked in against someone else's goal").not.toBeNull()

      // And impersonating them outright.
      const asThem = await owner.from("progress_entries").insert({
        goal_id: goalId,
        user_id: joinerId,
        check_in_date: today as string,
      })
      expect(asThem.error, "wrote a check-in as another user").not.toBeNull()

      const { data: written } = await admin
        .from("progress_entries")
        .select("id")
        .eq("goal_id", goalId)
      expect(written ?? [], "a check-in landed on someone else's goal").toEqual([])
    })
  })
})

test.describe("membership, and its inverse", () => {
  test("leaving a Circle takes your visibility with it", async () => {
    // Joining grants sight of a Circle. The inverse is the untested half: does
    // leaving revoke it, or does `shares_group_with` keep answering true from
    // some cached or stale row?
    const owner = await clientFor(requireEnv("E2E_OWNER_EMAIL"))
    const joiner = await clientFor(requireEnv("E2E_JOINER_EMAIL"))
    const joinerId = await userIdByEmail(requireEnv("E2E_JOINER_EMAIL"))

    const { groupId, token } = await circleWithLink(owner, "leave")
    assertOk(await joiner.rpc("join_circle", { p_token: token }), "join")

    const before = await joiner.rpc("circle_roster", { p_group_id: groupId })
    expect(before.error, "a member could not read the roster").toBeNull()

    const left = await joiner
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", joinerId)
      .select("group_id")
    expect(left.data ?? [], "a plain member could not leave").toHaveLength(1)

    const after = await joiner.rpc("circle_roster", { p_group_id: groupId })
    expect(after.error?.hint, "visibility survived leaving the Circle").toBe(
      "NOT_A_MEMBER",
    )

    // And the Circle itself disappears from their own reads.
    const { data: stillVisible } = await joiner
      .from("group_members")
      .select("group_id")
      .eq("group_id", groupId)
    expect(stillVisible ?? [], "a former member still reads the membership").toEqual([])
  })

  test("an owner cannot leave their own Circle", async () => {
    // The other half of the same policy: `role <> 'owner'`. This is what makes
    // the solo-owner trap real, and why `archive_circle` had to exist. If this
    // ever starts passing, a Circle can be orphaned again.
    const owner = await clientFor(requireEnv("E2E_OWNER_EMAIL"))
    const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))

    const { groupId } = await circleWithLink(owner, "owner-leave")

    const attempt = await owner
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", ownerId)
      .select("group_id")

    // RLS filters rather than erroring, so the affected-row count is the only
    // evidence. Zero rows and no error is the correct, quiet refusal.
    expect(attempt.error, "expected a silent filter, not an error").toBeNull()
    expect(attempt.data ?? [], "the owner removed themselves").toEqual([])

    const { data: still } = await admin
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", ownerId)
    expect(still?.[0]?.role, "the owner is no longer the owner").toBe("owner")
  })
})

test.describe("invite links, past their moment", () => {
  test("an expired link previews as dead and refuses the join", async () => {
    // `INVITE_REVOKED` is covered by the UI suite. `INVITE_EXPIRED` is a
    // different branch, reached only by the passage of time, so nothing has
    // ever exercised it.
    const owner = await clientFor(requireEnv("E2E_OWNER_EMAIL"))
    const joiner = await clientFor(requireEnv("E2E_JOINER_EMAIL"))

    const { groupId, token } = await circleWithLink(owner, "expired")

    // Still enabled, just past its date: that is the whole point. A revoked
    // link would take a different branch and prove nothing about this one.
    const expired = await admin
      .from("invite_links")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("group_id", groupId)
      .select("token")
    assertOk(expired, "expire the link")
    expect(expired.data, "no link was expired").toHaveLength(1)

    const preview = await joiner.rpc("circle_preview", { p_token: token })
    assertOk(preview, "preview the expired link")
    expect(preview.data[0]?.status, "an expired link did not preview as expired").toBe(
      "expired",
    )

    const { error } = await joiner.rpc("join_circle", { p_token: token })
    expect(error?.hint, "an expired link still let someone join").toBe("INVITE_EXPIRED")

    const { data: members } = await admin
      .from("group_members")
      .select("user_id")
      .eq("group_id", groupId)
    expect(members ?? [], "the Circle gained a member from an expired link").toHaveLength(1)
  })
})

test.describe("the goal cap, on the path nobody checks", () => {
  test("un-archiving cannot take you past ten active goals", async () => {
    // `enforce_active_goal_cap` fires on INSERT and on UPDATE, and the UPDATE
    // case is the one no interface reaches: archive a goal, add a replacement,
    // then restore the old one. If only INSERT were guarded this is how you
    // would end up with eleven.
    //
    // It also happens to be the assumption `restoreGoalSlot` in `e2e/db.ts`
    // rests on, so this test guards the test suite as well as the product.
    // The owner account, not the joiner: this test only means anything at the
    // cap, and the joiner may legitimately have no goals at all.
    const atCapId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))

    const active = await admin
      .from("goals")
      .select("id")
      .eq("user_id", atCapId)
      .is("archived_at", null)
      .is("achieved_at", null)
      .order("created_at", { ascending: false })
    assertOk(active, "count the joiner's active goals")

    // Only meaningful at the cap. Below it, restoring is legitimately fine.
    test.skip(
      active.data.length < 10,
      `needs an account at the 10-goal cap, this one has ${active.data.length}`,
    )

    const victim = active.data[0].id
    const category = await admin.from("goal_categories").select("id").limit(1).single()
    assertOk(category, "read a goal category")

    let replacement: string | null = null
    try {
      // Backdated a minute: `goals_archived_not_future` is checked against the
      // database clock, and the caller's is not it. See `archivedAtNow`.
      await admin
        .from("goals")
        .update({ archived_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("id", victim)

      const created = await admin
        .from("goals")
        .insert({
          user_id: atCapId,
          title: "E2E CAP PROBE",
          category_id: category.data.id,
        })
        .select("id")
        .single()
      assertOk(created, "fill the freed slot")
      replacement = created.data.id

      // Back at ten. Restoring the archived one would make eleven.
      const { error } = await admin
        .from("goals")
        .update({ archived_at: null })
        .eq("id", victim)

      expect(error, "un-archiving slipped past the active goal cap").not.toBeNull()
      expect(error?.hint, "the cap refused, but without its code").toBe("GOAL_LIMIT")
    } finally {
      if (replacement) await admin.from("goals").delete().eq("id", replacement)
      // Restore last, once the slot is free again.
      await admin.from("goals").update({ archived_at: null }).eq("id", victim)
    }
  })
})
