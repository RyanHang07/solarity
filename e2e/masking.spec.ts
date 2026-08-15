import { test, expect } from "@playwright/test"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import {
  admin,
  requireEnv,
  circleName,
  clearRateLimits,
  deleteE2ECircles,
  assertOk,
  freeGoalSlot,
  restoreGoalSlot,
  userIdByEmail,
} from "./db"

/**
 * The guard on migration 64, at the layer the bug actually lived in.
 *
 * **No browser.** Every other spec drives the UI, which is the wrong tool here:
 * the leak was that a circle-mate could read another member's goal titles and
 * check-in notes straight from PostgREST, whether or not any screen rendered
 * them. Masking that happens only in React is not masking. So this test holds a
 * real signed-in session and asks the API directly, exactly as a curious person
 * with devtools would.
 *
 * The service-role client is used only to set the stage and to clean up. Every
 * assertion runs through an ordinary `authenticated` session.
 */

const HIDDEN_TITLE = "E2E HIDDEN TITLE MUST NOT LEAK"
const HIDDEN_NOTE = "E2E HIDDEN NOTE MUST NOT LEAK"
const SHARED_NOTE = "E2E SHARED NOTE IS FINE"

/**
 * A client authenticated as a real user, built the same way `auth.setup.ts`
 * builds its cookies: mint a magic-link token with the admin API and redeem it.
 * No password, no Google, no user modified.
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

test.describe("a circle-mate cannot read what they should not", () => {
  test("goals, notes, and the roster that replaced them", async () => {
    await clearRateLimits()

    const ownerEmail = requireEnv("E2E_OWNER_EMAIL")
    const joinerEmail = requireEnv("E2E_JOINER_EMAIL")
    const ownerId = await userIdByEmail(ownerEmail)
    const joinerId = await userIdByEmail(joinerEmail)

    const owner = await clientFor(ownerEmail)
    const joiner = await clientFor(joinerEmail)

    // ---- stage: a Circle they share, and one hidden goal belonging to the
    // owner, checked off, carrying a note the owner never shared.
    const name = circleName("mask")
    const { data: groupId, error: createError } = await owner.rpc("create_circle", {
      p_name: name,
    })
    expect(createError, `create_circle: ${createError?.message}`).toBeNull()

    const { data: token } = await owner.rpc("create_invite_link", {
      p_group_id: groupId as string,
    })
    const { error: joinError } = await joiner.rpc("join_circle", {
      p_token: token as string,
    })
    expect(joinError, `join_circle: ${joinError?.message}`).toBeNull()

    const category = await admin.from("goal_categories").select("id").limit(1).single()
    assertOk(category, "read a goal category")

    // Both accounts are real ones used by hand, and the cap is 10 active goals.
    // The owner sits at exactly 10, so an eleventh insert fails on GOAL_LIMIT.
    const freed = await freeGoalSlot(ownerId)

    let goalId: string | null = null
    try {
      const created = await admin
        .from("goals")
        .insert({ user_id: ownerId, title: HIDDEN_TITLE, category_id: category.data.id })
        .select("id")
        .single()
      assertOk(created, "create the hidden goal")
      goalId = created.data.id

      const hidden = await admin
          .from("goal_group_visibility")
          .insert({ goal_id: goalId, group_id: groupId as string, hidden: true })
          .select("goal_id")
          .single()
      assertOk(hidden, "hide the goal in this Circle")

      const { data: today } = await owner.rpc("current_checkin_date")
      const hiddenEntry = await admin
          .from("progress_entries")
          .insert({
            goal_id: goalId,
            user_id: ownerId,
            check_in_date: today as string,
            note: HIDDEN_NOTE,
            // Shared, and still must not appear: the goal is hidden here.
            note_shared: true,
          })
          .select("id")
          .single()
      assertOk(hiddenEntry, "check the hidden goal off")

      // ---- the assertions, all as the joiner's own session ----

      // The leak itself. Before migration 64 this returned every title.
      const { data: theirGoals } = await joiner
        .from("goals")
        .select("id, title")
        .eq("user_id", ownerId)
      expect(theirGoals ?? [], "a circle-mate could read another member's goals").toEqual([])

      const { data: theirEntries } = await joiner
        .from("progress_entries")
        .select("id, note")
        .eq("user_id", ownerId)
      expect(theirEntries ?? [], "a circle-mate could read another member's notes").toEqual([])

      // Unfiltered, in case the filter above was doing the work rather than RLS.
      const { data: allGoals } = await joiner.from("goals").select("user_id")
      expect(
        (allGoals ?? []).filter((g) => g.user_id !== joinerId),
        "an unfiltered read returned someone else's rows",
      ).toEqual([])

      // ---- and the replacement path returns the right shape ----
      const { data: roster, error: rosterError } = await joiner.rpc("circle_roster", {
        p_group_id: groupId as string,
      })
      expect(rosterError, `circle_roster: ${rosterError?.message}`).toBeNull()

      const serialised = JSON.stringify(roster)
      expect(serialised, "hidden title reached a circle-mate").not.toContain(HIDDEN_TITLE)
      expect(
        serialised,
        "a shared note on a goal hidden in this Circle reached a circle-mate",
      ).not.toContain(HIDDEN_NOTE)

      const rows = (roster ?? []) as { user_id: string; is_self: boolean }[]
      expect(rows.map((r) => r.user_id).sort()).toEqual([ownerId, joinerId].sort())
      expect(rows[0].is_self, "the roster does not put you first").toBe(true)

      // A Circle you are not in stays shut, even though the function is DEFINER.
      const { error: foreignError } = await joiner.rpc("circle_roster", {
        p_group_id: "00000000-0000-0000-0000-000000000000",
      })
      expect(foreignError?.hint, "a non-member could read a roster").toBe("NOT_A_MEMBER")

      // ---- the owner's own data still reaches the owner ----
      const { data: ownGoals } = await owner
        .from("goals")
        .select("title")
        .eq("id", goalId)
      expect(
        ownGoals?.[0]?.title,
        "the owner cannot read their own goal, so this is too tight",
      ).toBe(HIDDEN_TITLE)
    } finally {
      // Undone whatever happened above, including on a failed assertion, and in
      // the reverse order it was done. `restoreGoalSlot` last, so a crash
      // between the two leaves the account short a goal rather than over cap.
      if (goalId) {
        await admin.from("progress_entries").delete().eq("goal_id", goalId)
        await admin.from("goal_group_visibility").delete().eq("goal_id", goalId)
        await admin.from("goals").delete().eq("id", goalId)
      }
      await deleteE2ECircles()
      await restoreGoalSlot(freed)
    }
  })

  test("a shared note on a visible goal does reach the Circle", async () => {
    // The counterpart to the test above. Without it, a roster that returned no
    // notes at all under any condition would pass everything, and the feature
    // would be silently dead rather than merely wrong.
    await clearRateLimits()

    const ownerEmail = requireEnv("E2E_OWNER_EMAIL")
    const ownerId = await userIdByEmail(ownerEmail)
    const owner = await clientFor(ownerEmail)
    const joiner = await clientFor(requireEnv("E2E_JOINER_EMAIL"))

    const name = circleName("shared-note")
    const { data: groupId } = await owner.rpc("create_circle", { p_name: name })
    const { data: token } = await owner.rpc("create_invite_link", {
      p_group_id: groupId as string,
    })
    await joiner.rpc("join_circle", { p_token: token as string })

    const category = await admin.from("goal_categories").select("id").limit(1).single()
    assertOk(category, "read a goal category")
    const freed = await freeGoalSlot(ownerId)

    let goalId: string | null = null
    try {
      const created = await admin
        .from("goals")
        .insert({ user_id: ownerId, title: "E2E VISIBLE GOAL", category_id: category.data.id })
        .select("id")
        .single()
      assertOk(created, "create the visible goal")
      goalId = created.data.id

      const { data: today } = await owner.rpc("current_checkin_date")
      const sharedEntry = await admin
          .from("progress_entries")
          .insert({
            goal_id: goalId,
            user_id: ownerId,
            check_in_date: today as string,
            note: SHARED_NOTE,
            note_shared: true,
          })
          .select("id")
          .single()
      assertOk(sharedEntry, "check the visible goal off")

      const { data: roster } = await joiner.rpc("circle_roster", {
        p_group_id: groupId as string,
      })
      expect(
        JSON.stringify(roster),
        "a shared note on a visible goal did not reach the Circle",
      ).toContain(SHARED_NOTE)

      // Un-sharing takes effect on the next read, with no backfill.
      await admin
        .from("progress_entries")
        .update({ note_shared: false })
        .eq("goal_id", goalId)

      const { data: after } = await joiner.rpc("circle_roster", {
        p_group_id: groupId as string,
      })
      expect(JSON.stringify(after), "un-sharing did not take effect").not.toContain(
        SHARED_NOTE,
      )
    } finally {
      if (goalId) {
        await admin.from("progress_entries").delete().eq("goal_id", goalId)
        await admin.from("goals").delete().eq("id", goalId)
      }
      await deleteE2ECircles()
      await restoreGoalSlot(freed)
    }
  })
})
