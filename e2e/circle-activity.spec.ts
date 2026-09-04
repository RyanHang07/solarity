import { test, expect } from "@playwright/test"
import {
  admin,
  assertOk,
  checkinDateFor,
  createCircleViaApi,
  deleteE2ECircles,
  inviteTokenFor,
  parkActiveGoals,
  requireEnv,
  restoreGoalSlots,
  sessionFor,
  userIdByEmail,
} from "./db"
import { storageStateFor } from "./session"

/**
 * Step 19. The four notifications a Circle sends during the day.
 *
 * **Asserted at the database, not through the screen, and that is the honest
 * place for them.** Three of the four are written by triggers and delivered by
 * an hourly cron; only one of them is ever rendered in a way a browser can see
 * without waiting for that cron. Driving the UI would test the notifications
 * tab, which already has its own spec, while the thing that can actually break
 * — who gets a row and how many — would go unexamined.
 *
 * **Every ceiling here is a claim about volume**, and volume is what ruled out
 * the obvious version of this feature: 180 rows a day inside one full Circle.
 * So the assertions are counts, and each has a control proving a row could have
 * been written at all.
 *
 * **Writes** one Circle, two goals, check-ins and notifications. All removed,
 * and the goals both accounts already had are parked for the duration so the
 * counts belong to the fixture rather than to the account.
 */

const OWNER = () => requireEnv("E2E_OWNER_EMAIL")
const JOINER = () => requireEnv("E2E_JOINER_EMAIL")

const INTRADAY = [
  "circle_activity",
  "circle_first_finisher",
  "last_one_left",
  "goal_achieved",
] as const

type Intraday = (typeof INTRADAY)[number]

/**
 * Circle names are fixture-generated (`E2E push only 733058`) and safe today,
 * but a name reaches a `RegExp` here and a name is user input everywhere else.
 * Escaping costs one line and removes the question.
 */
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Rows of one kind, for one person, in one Circle. */
async function rowsFor(userId: string, groupId: string, type: Intraday) {
  const { data } = await admin
    .from("notifications")
    .select("id, payload")
    .eq("user_id", userId)
    .eq("type", type)
  return (data ?? []).filter(
    (n) => (n.payload as { group_id?: string })?.group_id === groupId,
  )
}

async function clearIntraday(userIds: string[]) {
  await admin.from("notifications").delete().in("user_id", userIds).in("type", INTRADAY)
}

/**
 * Two accounts in one Circle, one goal each, and nothing else of their own.
 *
 * **Parking is not tidiness.** "Finished their day" is `daily_completion`, which
 * counts *every* active goal a person has, so a stray goal on either account
 * means checking in once no longer completes the day and every assertion below
 * silently stops meaning what it says. Same reasoning as `roster.spec.ts`.
 */
async function circleOfTwo(label: string) {
  const ownerId = await userIdByEmail(OWNER())
  const joinerId = await userIdByEmail(JOINER())

  const { groupId, name } = await createCircleViaApi(OWNER(), label)
  const token = await inviteTokenFor(OWNER(), groupId)
  const joiner = await sessionFor(JOINER())
  const joined = await joiner.rpc("join_circle", { p_token: token })
  if (joined.error) throw new Error(`join_circle: ${joined.error.message}`)

  const category = await admin.from("goal_categories").select("id").limit(1).single()
  assertOk(category, "read a goal category")

  const parkedOwner = await parkActiveGoals(ownerId)
  const parkedJoiner = await parkActiveGoals(joinerId)
  const goals: Record<string, string> = {}

  try {
    for (const [who, id] of [
      ["owner", ownerId],
      ["joiner", joinerId],
    ] as const) {
      const created = await admin
        .from("goals")
        .insert({ user_id: id, title: `E2E ${label} ${who}`, category_id: category.data.id })
        .select("id")
        .single()
      if (created.error) throw new Error(`goal for ${who}: ${created.error.message}`)
      goals[who] = created.data.id
    }
  } catch (e) {
    await restoreGoalSlots([...parkedOwner, ...parkedJoiner])
    throw e
  }

  await clearIntraday([ownerId, joinerId])

  return {
    ownerId,
    joinerId,
    groupId,
    name,
    goals,
    async cleanup() {
      await admin.from("progress_entries").delete().in("goal_id", Object.values(goals))
      await admin.from("goals").delete().in("id", Object.values(goals))
      await admin.from("daily_completion").delete().in("user_id", [ownerId, joinerId])
      await clearIntraday([ownerId, joinerId])
      await restoreGoalSlots([...parkedOwner, ...parkedJoiner])
    },
  }
}

/** A check-in written as the person themselves, so the date is their own. */
async function checkIn(email: string, userId: string, goalId: string) {
  const date = await checkinDateFor(email)
  assertOk(
    await admin
      .from("progress_entries")
      .insert({ user_id: userId, goal_id: goalId, check_in_date: date })
      .select("goal_id"),
    "write a check-in",
  )
  return date
}

test.afterAll(async () => {
  await deleteE2ECircles()
})

test("a first check-in reaches the Circle once, however many follow", async () => {
  const s = await circleOfTwo("activity")

  try {
    await checkIn(JOINER(), s.joinerId, s.goals.joiner)

    const first = await rowsFor(s.ownerId, s.groupId, "circle_activity")
    expect(first.length, "the owner heard nothing about the joiner starting").toBe(1)
    expect(
      (first[0].payload as { names?: string[] }).names?.length,
      "the activity row names nobody",
    ).toBe(1)

    // Never about yourself.
    expect(
      (await rowsFor(s.joinerId, s.groupId, "circle_activity")).length,
      "the joiner was told about their own check-in",
    ).toBe(0)

    /**
     * **The coalescing claim, and the reason this feature is shippable.** The
     * owner checking in is a second event in the same Circle, and it must join
     * the joiner's undelivered row rather than land beside it. Read from the
     * joiner's side, because the owner is the actor this time.
     */
    await checkIn(OWNER(), s.ownerId, s.goals.owner)

    const joinerRows = await rowsFor(s.joinerId, s.groupId, "circle_activity")
    expect(joinerRows.length, "a second row appeared instead of an append").toBe(1)

    // And the owner still has exactly one: nothing about themselves was added.
    expect(
      (await rowsFor(s.ownerId, s.groupId, "circle_activity")).length,
      "the owner's row multiplied",
    ).toBe(1)
  } finally {
    await s.cleanup()
  }
})

test("finishing first tells the Circle, and being last tells you", async () => {
  const s = await circleOfTwo("finishing")

  try {
    // One goal each, so one check-in finishes a day.
    await checkIn(JOINER(), s.joinerId, s.goals.joiner)

    const finisher = await rowsFor(s.ownerId, s.groupId, "circle_first_finisher")
    expect(finisher.length, "nobody was told who finished first").toBe(1)

    // **The two halves of one fact.** With two members, the first finisher also
    // makes the other person the last one left, and both rows go to the owner.
    const waiting = await rowsFor(s.ownerId, s.groupId, "last_one_left")
    expect(waiting.length, "the owner was not told the Circle is waiting").toBe(1)

    // Never to the person who finished.
    expect(
      (await rowsFor(s.joinerId, s.groupId, "last_one_left")).length,
      "the person who finished was told they were the last one",
    ).toBe(0)

    /**
     * **Undo and redo must not send it twice**, which is what the date guard in
     * migration 103 is for. Completions do not only go up: undoing a check-in
     * flips `all_completed` back to false, and redoing it re-fires the trigger.
     */
    await admin.from("progress_entries").delete().eq("goal_id", s.goals.joiner)
    await checkIn(JOINER(), s.joinerId, s.goals.joiner)

    expect(
      (await rowsFor(s.ownerId, s.groupId, "circle_first_finisher")).length,
      "re-finishing the same day sent a second notification",
    ).toBe(1)
    expect(
      (await rowsFor(s.ownerId, s.groupId, "last_one_left")).length,
      "re-finishing the same day sent a second waiting notification",
    ).toBe(1)

    // Then the owner finishes too, and nobody is last any more.
    await checkIn(OWNER(), s.ownerId, s.goals.owner)
    expect(
      (await rowsFor(s.joinerId, s.groupId, "last_one_left")).length,
      "the joiner was told they were last after everyone had finished",
    ).toBe(0)
  } finally {
    await s.cleanup()
  }
})

test("achieving a goal is announced, unless the goal is hidden there", async () => {
  const s = await circleOfTwo("achieving")

  try {
    // The control first: a visible goal reaches the Circle.
    /**
     * **`"now"`, not `new Date().toISOString()`.**
     *
     * `goals_achieved_not_future` is `achieved_at <= now()`, and `now()` is the
     * *database's* clock. A timestamp taken from the test runner's clock fails
     * that check whenever the runner is even milliseconds ahead of Postgres —
     * which is not a hypothetical, it is what made this test red.
     *
     * Postgres parses the string `now` as the transaction timestamp, so the
     * value is produced on the same clock the constraint is checked against and
     * the skew cannot exist. `goals.spec.ts` has always done it this way.
     */
    assertOk(
      await admin
        .from("goals")
        .update({ achieved_at: "now" })
        .eq("id", s.goals.owner)
        .select("id"),
      "achieve the owner's goal",
    )

    expect(
      (await rowsFor(s.joinerId, s.groupId, "goal_achieved")).length,
      "achieving a visible goal told nobody",
    ).toBe(1)

    // **And the title never travels.** Masking is per Circle; the payload is
    // what a lock screen renders, and it must not carry one.
    const row = (await rowsFor(s.joinerId, s.groupId, "goal_achieved"))[0]
    expect(
      JSON.stringify(row.payload),
      "the achievement payload carries the goal's title",
    ).not.toContain("E2E achieving owner")

    /**
     * **Hidden in this Circle, so silent in this Circle.** Migration 83 makes
     * achieving final, so a second goal is needed rather than un-achieving the
     * first — which is also why this is the one notification that cannot be
     * tested by repeating it.
     */
    const category = await admin.from("goal_categories").select("id").limit(1).single()
    assertOk(category, "read a goal category")
    const hidden = await admin
      .from("goals")
      .insert({
        user_id: s.ownerId,
        title: "E2E achieving hidden",
        category_id: category.data.id,
      })
      .select("id")
      .single()
    assertOk(hidden, "create a hidden goal")

    await admin
      .from("goal_group_visibility")
      .insert({ goal_id: hidden.data.id, group_id: s.groupId, hidden: true })

    await admin
      .from("goals")
      // The database's clock, not the runner's. See the note above.
      .update({ achieved_at: "now" })
      .eq("id", hidden.data.id)

    expect(
      (await rowsFor(s.joinerId, s.groupId, "goal_achieved")).length,
      "a goal hidden in this Circle announced itself there anyway",
    ).toBe(1)

    await admin.from("goals").delete().eq("id", hidden.data.id)
  } finally {
    await s.cleanup()
  }
})

/**
 * The preference columns, which are the difference between a feature and a
 * reason to turn notifications off entirely.
 *
 * **Asserted by turning one off and leaving the rest on**, so a bug that
 * silenced everything would fail the control rather than pass the test.
 */
test("a switch turned off stops the row being written at all", async () => {
  const s = await circleOfTwo("prefs")

  try {
    assertOk(
      await admin
        .from("users")
        .update({ notify_circle_activity: false })
        .eq("id", s.ownerId)
        .select("id"),
      "turn off activity for the owner",
    )

    await checkIn(JOINER(), s.joinerId, s.goals.joiner)

    expect(
      (await rowsFor(s.ownerId, s.groupId, "circle_activity")).length,
      "an account that switched activity off still received it",
    ).toBe(0)

    // **The control, and it is the whole test.** The same check-in that wrote
    // no activity row did finish the joiner's day, so the other two kinds must
    // still have arrived. Without this, a bug that wrote nothing at all would
    // pass the assertion above.
    expect(
      (await rowsFor(s.ownerId, s.groupId, "circle_first_finisher")).length,
      "switching one kind off silenced the others",
    ).toBe(1)
  } finally {
    await admin
      .from("users")
      .update({ notify_circle_activity: true })
      .eq("id", s.ownerId)
    await s.cleanup()
  }
})

/**
 * Step 19's one claim that is about a screen: `circle_activity` is push-only.
 *
 * It is in no `TAB_NOTIFICATION_TYPES` entry, so it must not appear in the tab
 * and must not move the badge. A row that can arrive hourly and leaves
 * something to clear would cost the three types beside it the attention they
 * exist for.
 */
test("activity never reaches the notifications tab", async ({ browser }) => {
  const s = await circleOfTwo("push only")

  const context = await browser.newContext({
    storageState: await storageStateFor(OWNER()),
  })
  const page = await context.newPage()

  try {
    await checkIn(JOINER(), s.joinerId, s.goals.joiner)

    // Both kinds exist in the database, which is what makes the absence below
    // meaningful rather than vacuous.
    expect((await rowsFor(s.ownerId, s.groupId, "circle_activity")).length).toBe(1)
    expect(
      (await rowsFor(s.ownerId, s.groupId, "circle_first_finisher")).length,
    ).toBe(1)

    await page.goto("/dashboard/notifications")
    const panel = page.getByRole("region", { name: "Notifications" })

    /**
     * **Scoped to this test's Circle, because the account is in several.**
     *
     * The unscoped version resolved to six rows and failed as a strict-mode
     * violation. That is not leakage: `circle_first_finisher` is per Circle, the
     * two accounts still shared five earlier fixture Circles that only
     * `afterAll` removes, and one check-in correctly told each of them. The
     * database assertions above were already scoped by `group_id` and read 1;
     * only this locator was asking a question about the whole account.
     *
     * Naming the Circle also makes it a stronger assertion than before: it can
     * no longer be satisfied by a notification from some other Circle entirely.
     */
    await expect(
      panel.getByText(new RegExp(`finished first in ${escapeRegExp(s.name)}`)),
    ).toBeVisible()

    // And the one that does not, is not. Asserted on the wording only this type
    // produces, so it cannot pass because the list happens to be empty.
    await expect(panel.getByText(/got started|off the mark|has begun/)).toHaveCount(0)
  } finally {
    await page.close()
    await context.close()
    await s.cleanup()
  }
})
