import { test, expect } from "@playwright/test"
import {
  admin,
  checkinDateFor,
  deleteE2EGoals,
  E2E_PREFIX,
  freeGoalSlots,
  requireEnv,
  restoreGoalSlots,
  sessionFor,
  userIdByEmail,
} from "./db"
// **The app's own date arithmetic, not the runner's.** `addDays` is UTC-pinned;
// building these with `new Date()` would shift the day at a negative offset and
// the test would be asserting against a date the account never had.
import { addDays } from "@/lib/digest-days"
import { storageStateFor } from "./session"

/**
 * Step 14c. `total_goals_achieved` for one account, read and put back.
 *
 * **Achieving is the one lifecycle write with no undo.** `deleteE2EGoals`
 * removes the goal but the counter has already moved, and no trigger walks it
 * back — migration 83 refuses to clear `achieved_at`, which is the whole point
 * of it. So a test that achieves a goal on a real account inflates that
 * person's lifetime stat by one, every run, forever.
 *
 * These two are the `freeGoalSlots`/`restoreGoalSlots` pair for the counter:
 * capture before, restore in a `finally`. Written against `admin` because the
 * table has no client-facing writer at all, which is correct.
 */
async function achievedCount(userId: string): Promise<number> {
  const { data, error } = await admin
    .from("user_lifetime_stats")
    .select("total_goals_achieved")
    .eq("user_id", userId)
    .single()
  if (error) throw error
  return data.total_goals_achieved
}

async function restoreAchievedCount(userId: string, value: number) {
  const { error } = await admin
    .from("user_lifetime_stats")
    .update({ total_goals_achieved: value })
    .eq("user_id", userId)
  if (error) throw error
}

/**
 * Creating and archiving a goal, through the screen rather than the API.
 *
 * **Written because archiving reportedly did nothing in a real browser**, with
 * only a `share-modal.js` error in the console — a file this repo does not
 * contain and does not serve, so a browser extension. That is a claim, not a
 * diagnosis, and the suite had no test that ever clicked Archive, so it could
 * not tell an app bug from an extension. This is that test.
 *
 * It asserts the two halves separately, because they fail for different
 * reasons and look identical from the outside:
 *
 * | Half | If it fails |
 * |---|---|
 * | the row leaves the active list | the write landed and the page did not refresh |
 * | `archived_at` is set | the click never reached the server |
 *
 * **Writes.** Creates one goal named `E2E …` and archives it, then deletes it.
 * Frees a slot first if the account is at the 10-goal cap, and puts that slot
 * back afterwards.
 */

test("a goal can be created and archived from the dashboard", async ({ browser }) => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
  // Named with the suite's prefix so `deleteE2EGoals` and the standalone clean
  // script can both find it if this test dies mid-flight.
  const title = `${E2E_PREFIX}archive me ${Date.now().toString().slice(-6)}`

  // The cap is per account and these are real accounts, so a full list would
  // fail the create rather than the archive, and the failure would read like a
  // bug in the thing under test.
  const freed = await freeGoalSlots(userId, 1)

  const context = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
  })
  const page = await context.newPage()

  try {
    await page.goto("/dashboard")

    // The section is named because the dashboard prints each title twice, here
    // and in Today, and an unanchored locator would be ambiguous the moment the
    // goal exists.
    const goals = page.getByRole("region", { name: "Your goals" })

    await goals.getByLabel("Goal title").fill(title)
    await goals.getByLabel("Category").selectOption({ index: 1 })
    await goals.getByRole("button", { name: "Add goal" }).click()

    const row = goals.getByRole("listitem").filter({ hasText: title })
    await expect(row).toBeVisible()

    await row.getByRole("button", { name: "Archive" }).click()

    // Gone from the screen…
    await expect(row).toHaveCount(0)

    // …and gone in the database. Either alone would let a real failure pass:
    // a stale render hides a successful write, and an optimistic UI would hide
    // a failed one.
    const { data } = await admin
      .from("goals")
      .select("archived_at")
      .eq("user_id", userId)
      .eq("title", title)
      .maybeSingle()

    expect(data?.archived_at).toBeTruthy()

    // And nothing was reported to the person, since this is the happy path.
    await expect(goals.locator('p[role="alert"]')).toHaveCount(0)
  } finally {
    await deleteE2EGoals()
    await restoreGoalSlots(freed)
    await context.close()
  }
})

test("archiving twice is refused in words, not silently", async ({ browser }) => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
  const title = `${E2E_PREFIX}already archived ${Date.now().toString().slice(-6)}`
  const freed = await freeGoalSlots(userId, 1)

  const context = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
  })
  const page = await context.newPage()

  try {
    await page.goto("/dashboard")
    const goals = page.getByRole("region", { name: "Your goals" })

    await goals.getByLabel("Goal title").fill(title)
    await goals.getByLabel("Category").selectOption({ index: 1 })
    await goals.getByRole("button", { name: "Add goal" }).click()

    const row = goals.getByRole("listitem").filter({ hasText: title })
    await expect(row).toBeVisible()

    // Archived behind the page's back, so the click lands on a goal that is
    // already gone. `archiveGoal` filters on `archived_at is null` and reads the
    // affected-row count, which is the only evidence RLS leaves.
    const { data: created } = await admin
      .from("goals")
      .select("id")
      .eq("user_id", userId)
      .eq("title", title)
      .maybeSingle()

    // `"now"` rather than `new Date()`, for the reason this file exists: the
    // runner's clock is no more trustworthy than the app server's, and
    // `goals_archived_not_future` judges both against Postgres.
    await admin.from("goals").update({ archived_at: "now" }).eq("id", created!.id)

    await row.getByRole("button", { name: "Archive" }).click()

    // The point: a write that changed nothing says so. Silence here would be
    // indistinguishable from success, which is what "nothing happened when I
    // clicked" feels like from the other side of the screen.
    await expect(goals.getByText(/already archived, or isn't yours/i)).toBeVisible()
  } finally {
    await deleteE2EGoals()
    await restoreGoalSlots(freed)
    await context.close()
  }
})

/**
 * Step 14c. Achieving, which is archiving's better-outcome twin and behaves
 * differently in exactly two ways.
 *
 * | | Archive | Achieve |
 * |---|---|---|
 * | Moves today's denominator | yes | yes |
 * | Moves `total_goals_achieved` | no | **yes** |
 * | Reversible | yes | **no**, migration 83 |
 *
 * Both differences are asserted here, because the first is what makes the
 * feature worth having and the second is what makes it dangerous.
 */
test("a goal can be achieved, and the lifetime counter moves once", async ({
  browser,
}) => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
  const title = `${E2E_PREFIX}achieve me ${Date.now().toString().slice(-6)}`
  const freed = await freeGoalSlots(userId, 1)
  const before = await achievedCount(userId)

  const context = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
  })
  const page = await context.newPage()

  // **Playwright dismisses dialogs by default**, so without this the
  // confirmation is cancelled and the test asserts that nothing happened —
  // green for the wrong reason. Registered before the click, not after.
  page.on("dialog", (d) => d.accept())

  try {
    await page.goto("/dashboard")
    const goals = page.getByRole("region", { name: "Your goals" })

    await goals.getByLabel("Goal title").fill(title)
    await goals.getByLabel("Category").selectOption({ index: 1 })
    await goals.getByRole("button", { name: "Add goal" }).click()

    const row = goals.getByRole("listitem").filter({ hasText: title })
    await expect(row).toBeVisible()

    await row.getByRole("button", { name: "Achieve" }).click()

    // Gone from the active list…
    await expect(row).toHaveCount(0)

    // …but not gone. Achieved goals are history, not deletions, and the panel
    // has always had a place to put them.
    //
    // **The summary is located by its own text, not by `getByRole("group")`.**
    // Every active goal carries a `<details>` for its Circle visibility, and
    // `<details>` is `role="group"`, so that locator resolves to as many
    // elements as there are goals plus one.
    await goals.getByText(/^Archived and achieved \(\d+\)$/).click()
    await expect(
      goals.getByRole("listitem").filter({ hasText: title }).filter({
        hasText: "achieved",
      }),
      "the achieved goal is not listed as achieved",
    ).toHaveCount(1)

    const { data } = await admin
      .from("goals")
      .select("achieved_at, archived_at")
      .eq("user_id", userId)
      .eq("title", title)
      .maybeSingle()

    expect(data?.achieved_at, "achieved_at was not set").toBeTruthy()
    // **Achieved is not archived.** Both retire a goal and the panel groups
    // them together, so a bug that set the wrong column would look identical on
    // screen and be wrong in the counter, the export and the profile.
    expect(data?.archived_at, "achieving also archived the goal").toBeNull()

    expect(
      await achievedCount(userId),
      "total_goals_achieved did not move by exactly one",
    ).toBe(before + 1)

    await expect(goals.locator('p[role="alert"]')).toHaveCount(0)
  } finally {
    await deleteE2EGoals()
    // **Before `restoreGoalSlots`, and never skipped.** Deleting the goal does
    // not walk the counter back; nothing does.
    await restoreAchievedCount(userId, before)
    await restoreGoalSlots(freed)
    await context.close()
  }
})

/**
 * Migration 83, through PostgREST as a real signed-in user.
 *
 * **The migration proves this too, and that is not the same proof.** Its `do`
 * block runs as the table owner, where grants do not apply and RLS is bypassed.
 * This is the only way to know the trigger, the `update (achieved_at)` grant
 * and the UPDATE policy agree — the same reason `photos.spec.ts` re-proves
 * migration 79 through a user's own client.
 *
 * **API-level, with no browser.** There is no screen that tries to un-achieve a
 * goal; the claim is about what the database refuses, and a UI test could only
 * show that this UI does not ask.
 */
test("the database refuses to un-achieve a goal", async () => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
  const owner = await sessionFor(requireEnv("E2E_OWNER_EMAIL"))
  const title = `${E2E_PREFIX}final ${Date.now().toString().slice(-6)}`
  const freed = await freeGoalSlots(userId, 1)
  const before = await achievedCount(userId)

  try {
    const { data: category } = await admin
      .from("goal_categories")
      .select("id")
      .limit(1)
      .single()

    // Created and achieved through the *user's* client, so a revoked grant
    // would fail here rather than being masked by the service key.
    const { data: goal, error: insertError } = await owner
      .from("goals")
      .insert({ user_id: userId, title, category_id: category!.id })
      .select("id")
      .single()
    expect(insertError, "the user could not create a goal").toBeNull()

    const achieved = await owner
      .from("goals")
      .update({ achieved_at: "now" })
      .eq("id", goal!.id)
      .is("achieved_at", null)
      .select("id")
    // The negative control. A rule that refused everything would pass the
    // assertion below while breaking the feature entirely.
    expect(achieved.error, "a user could not achieve their own goal").toBeNull()
    expect(achieved.data, "achieving matched no rows").toHaveLength(1)

    // ------------------------------------------------------------ the refusal
    const cleared = await owner
      .from("goals")
      .update({ achieved_at: null })
      .eq("id", goal!.id)
      .select("id")

    expect(cleared.error, "un-achieving was allowed").not.toBeNull()
    // **The hint, not the message.** `lib/errors.ts` keys on it, and asserting
    // the sentence would make this test pass or fail on copy edits.
    expect(cleared.error?.hint).toBe("ACHIEVEMENT_FINAL")
    expect(cleared.error?.code).toBe("23514")

    // Moving it is refused too, not only clearing it.
    const moved = await owner
      .from("goals")
      .update({ achieved_at: "2020-01-01T00:00:00Z" })
      .eq("id", goal!.id)
      .select("id")
    expect(moved.error?.hint, "rewriting achieved_at was allowed").toBe(
      "ACHIEVEMENT_FINAL",
    )

    // And the counter is one ahead, not three. This is the whole reason the
    // trigger exists.
    expect(
      await achievedCount(userId),
      "the refused writes still moved the counter",
    ).toBe(before + 1)
  } finally {
    await deleteE2EGoals()
    await restoreAchievedCount(userId, before)
    await restoreGoalSlots(freed)
  }
})

/**
 * Step 14d. A deadline is set, changed and cleared by one control.
 *
 * **The assertion that earns this test is the stored value.** `goals.deadline`
 * was `timestamptz` until migration 84, and a date input submits `YYYY-MM-DD`,
 * which stored as midnight UTC. The owner account's check-in timezone is west
 * of UTC, so under the old column the date read back — and rendered — a day
 * early. Comparing the stored string to the typed string is what would catch a
 * revert; a screen assertion alone would not, because the label would be
 * consistently wrong in both places.
 */
test("a goal's deadline can be set, changed and cleared", async ({ browser }) => {
  const email = requireEnv("E2E_OWNER_EMAIL")
  const userId = await userIdByEmail(email)
  const title = `${E2E_PREFIX}deadline ${Date.now().toString().slice(-6)}`
  const freed = await freeGoalSlots(userId, 1)

  // The account's own check-in date, from Postgres. Never the runner's clock:
  // "overdue" is measured against the same day a check-in is.
  const today = await checkinDateFor(email)
  const future = addDays(today, 30)
  const past = addDays(today, -3)

  const context = await browser.newContext({
    storageState: await storageStateFor(email),
  })
  const page = await context.newPage()

  const stored = async () => {
    const { data } = await admin
      .from("goals")
      .select("deadline")
      .eq("user_id", userId)
      .eq("title", title)
      .maybeSingle()
    return data?.deadline ?? null
  }

  try {
    await page.goto("/dashboard")
    const goals = page.getByRole("region", { name: "Your goals" })

    await goals.getByLabel("Goal title").fill(title)
    await goals.getByLabel("Category").selectOption({ index: 1 })
    await goals.getByRole("button", { name: "Add goal" }).click()

    const row = goals.getByRole("listitem").filter({ hasText: title })
    await expect(row).toBeVisible()

    // A new goal has no deadline, and says nothing rather than defaulting to
    // today — which would make every goal look overdue tomorrow.
    expect(await stored(), "a new goal was given a deadline").toBeNull()
    await expect(row.getByText(/Due |Overdue/)).toHaveCount(0)

    // ------------------------------------------------------------------- set
    await row.getByLabel("Deadline").fill(future)
    await row.getByRole("button", { name: "Save" }).click()

    await expect(row.getByText(/^Due /)).toBeVisible()
    expect(
      await stored(),
      "the stored deadline is not the date that was typed",
    ).toBe(future)

    // --------------------------------------------------------------- changed
    // A past date is accepted rather than refused. `goals.deadline` is
    // deliberately unconstrained: recording a missed deadline is legitimate,
    // which is why there is no `min` on the input and no CHECK on the column.
    await row.getByLabel("Deadline").fill(past)
    await row.getByRole("button", { name: "Save" }).click()

    await expect(
      row.getByText(/^Overdue since /),
      "a past deadline was not marked overdue",
    ).toBeVisible()
    expect(await stored()).toBe(past)

    // ----------------------------------------------------------------- clear
    // Emptying the field is how a deadline is removed. There is no separate
    // button, and this is the assertion that says so.
    await row.getByLabel("Deadline").fill("")
    await row.getByRole("button", { name: "Save" }).click()

    await expect(row.getByText(/Due |Overdue/)).toHaveCount(0)
    expect(await stored(), "clearing the field did not remove the deadline").toBeNull()

    await expect(goals.locator('p[role="alert"]')).toHaveCount(0)
  } finally {
    await deleteE2EGoals()
    await restoreGoalSlots(freed)
    await context.close()
  }
})
