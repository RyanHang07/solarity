import { test, expect } from "@playwright/test"
import {
  admin,
  deleteE2EGoals,
  E2E_PREFIX,
  freeGoalSlots,
  requireEnv,
  restoreGoalSlots,
  userIdByEmail,
} from "./db"
import { storageStateFor } from "./session"

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
