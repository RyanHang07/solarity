import { test, expect } from "@playwright/test"
import {
  admin,
  checkinDateFor,
  createCircleViaApi,
  daysBack,
  deleteDigests,
  deleteE2ECircles,
  deleteNotifications,
  insertNotification,
  requireEnv,
  seedDigests,
  userIdByEmail,
} from "./db"
import { storageStateFor } from "./session"

/**
 * Step 11a. The day boxes on Overview.
 *
 * **Every fixture here is created by the test.** Digest snapshots are written
 * by a job that runs once per rollover, so an account's real history is
 * whatever happened to it — and asserting on that is the pattern that has now
 * broken this suite four times. A Circle made here, with snapshots written
 * here, is the only way these assertions mean something tomorrow.
 *
 * **Writes.** One Circle named `E2E …` and up to seven snapshots, all removed
 * afterwards.
 */

const OWNER = () => requireEnv("E2E_OWNER_EMAIL")

async function seededCircle(label: string, dayCount: number) {
  const email = OWNER()
  const userId = await userIdByEmail(email)
  const today = await checkinDateFor(email)
  if (!today) throw new Error("no check-in date for the owner")

  const { groupId, name } = await createCircleViaApi(email, label)
  const dates = daysBack(today, dayCount + 1).slice(1) // yesterday backwards

  await seedDigests(
    groupId,
    dates.map((date, i) => ({
      date,
      completed: i === 0 ? 1 : 2,
      members: 2,
      groupStreak: dayCount - i,
      roster: [
        { userId, username: "e2e_self", completed: i !== 0, streak: 3 },
        { userId: "00000000-0000-0000-0000-0000000000ff", username: "someone", completed: true, streak: 5 },
      ],
    })),
  )

  return { groupId, name, dates, userId }
}

test.afterAll(async () => {
  await deleteE2ECircles()
})

test("Overview groups digests into dated boxes, newest first, five at most", async ({
  browser,
}) => {
  const { groupId, name } = await seededCircle("boxes", 7)

  const context = await browser.newContext({ storageState: await storageStateFor(OWNER()) })
  const page = await context.newPage()

  try {
    await page.goto("/dashboard")
    const panel = page.getByRole("region", { name: "Recent days" })

    // Five boxes, not seven, however much history exists. Located by test id:
    // day boxes and Circle lines are both list items, so a role query matches
    // nested ones.
    await expect(panel.getByTestId("digest-day")).toHaveCount(5)

    // **Not a check for raw dates.** The panel renders "Fri 14 Aug", never
    // "2026-08-14", so asserting the ISO string is absent would pass however
    // many boxes rendered — a test that cannot fail.
    //
    // The newest box carries the seeded Circle, and the boxes descend.
    const headings = await panel.getByTestId("digest-day").locator("h3").allInnerTexts()
    expect(headings).toHaveLength(5)
    expect(headings[0], "the newest box should name today or yesterday").toMatch(
      /Today|Yesterday|\d/,
    )

    // **Scoped to the summary.** The expanded half carries an "Open {name}"
    // link, so an unscoped `getByText(name)` inside a box matches twice and
    // fails on strict mode — the name is deliberately in both places.
    await expect(
      panel.getByTestId("digest-day").first().locator("summary").filter({ hasText: name }),
    ).toBeVisible()

    // Seven days were seeded and two must be absent, which the count above
    // proves only if the seeded Circle is the one supplying those days.
    const { count } = await admin
      .from("digest_snapshots")
      .select("group_id", { count: "exact", head: true })
      .eq("group_id", groupId)
      .then((r) => ({ count: r.count ?? 0 }))
    expect(count, "the fixture should have seven days behind five boxes").toBe(7)
  } finally {
    await deleteDigests(groupId)
    await context.close()
  }
})

test("a box names who finished and who did not, and marks you", async ({ browser }) => {
  const { groupId, name } = await seededCircle("roll call", 2)

  const context = await browser.newContext({ storageState: await storageStateFor(OWNER()) })
  const page = await context.newPage()

  try {
    await page.goto("/dashboard")
    const panel = page.getByRole("region", { name: "Recent days" })

    // The roll call is inside a `<details>`, so it is in the document before
    // any click — which is the point of using one. Opened here because a person
    // would, and because `toBeVisible` is false while it is closed.
    const line = panel.getByTestId("digest-circle").filter({ hasText: name }).first()
    await line.locator("summary").click()

    await expect(line.getByText("someone")).toBeVisible()
    await expect(line.getByText("e2e_self (you)")).toBeVisible()

    // Counts, and the streak line that says which way it moved.
    await expect(line.getByText(/of 2 finished/).first()).toBeVisible()
    await expect(line.getByText(/Group streak/).first()).toBeVisible()
  } finally {
    await deleteDigests(groupId)
    await context.close()
  }
})

test("a Circle waiting on a decision sorts to the top of every box", async ({
  browser,
}) => {
  // Two Circles, alphabetically ordered so the flagged one would otherwise be
  // second. The flag is a fact about *now*, so it must lift the Circle in the
  // older box too.
  const first = await seededCircle("aaa quiet", 2)
  const second = await seededCircle("zzz waiting", 2)

  await admin
    .from("groups")
    .update({ streak_decision_pending: true })
    .eq("id", second.groupId)

  const context = await browser.newContext({ storageState: await storageStateFor(OWNER()) })
  const page = await context.newPage()

  try {
    await page.goto("/dashboard")
    const panel = page.getByRole("region", { name: "Recent days" })

    // **`allInnerTexts` does not auto-wait**, and since step 14a the panel
    // arrives through a Suspense boundary rather than with the document. Read
    // straight after `goto` it returned `[]` — every index -1, reported as a
    // missing Circle. One auto-waiting assertion first is the whole fix; the
    // reads below are then reads of a rendered list.
    await expect(panel.getByTestId("digest-day").nth(1)).toBeVisible()

    for (const boxIndex of [0, 1]) {
      const box = panel.getByTestId("digest-day").nth(boxIndex)
      const names = await box.getByTestId("digest-circle").allInnerTexts()
      const flagged = names.findIndex((t) => t.includes(second.name))
      const quiet = names.findIndex((t) => t.includes(first.name))

      expect(flagged, `box ${boxIndex}: the waiting Circle is missing`).toBeGreaterThanOrEqual(0)
      expect(
        flagged,
        `box ${boxIndex}: the waiting Circle should sort above the quiet one`,
      ).toBeLessThan(quiet)
    }
  } finally {
    await admin
      .from("groups")
      .update({ streak_decision_pending: false })
      .eq("id", second.groupId)
    await deleteDigests(first.groupId)
    await deleteDigests(second.groupId)
    await context.close()
  }
})

test("a snapshot with no roll call still shows its counts", async ({ browser }) => {
  const email = OWNER()
  const today = await checkinDateFor(email)
  const { groupId, name } = await createCircleViaApi(email, "no roster")

  // The shape a snapshot written before the roll call existed would have, and
  // the shape a future change to `summary` could produce. Neither should blank
  // the dashboard.
  await admin.from("digest_snapshots").insert({
    group_id: groupId,
    date: daysBack(today!, 2)[1],
    summary: { completed_count: 1, member_count: 3, group_streak: 0 },
  })

  const context = await browser.newContext({ storageState: await storageStateFor(email) })
  const page = await context.newPage()

  try {
    await page.goto("/dashboard")
    const panel = page.getByRole("region", { name: "Recent days" })

    await expect(panel.locator("summary").filter({ hasText: name })).toBeVisible()
    await expect(panel.getByText("1 of 3 finished").first()).toBeVisible()

    // And the rest of the page is still there: one malformed row must not take
    // it down. Today rather than a goals region, which Overview stopped
    // rendering when the summary was removed.
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
  } finally {
    await deleteDigests(groupId)
    await context.close()
  }
})

/* ------------------------------------------------------------------ 11c --
 * Digests leave the Notifications tab, and its badge.
 *
 * **Migration 112 made these rows impossible, and the tests stay.** Nothing
 * writes a `digest` notification any more — the snapshot is the digest, and
 * `digest_pushes` records delivery — so the exclusion in
 * `TAB_NOTIFICATION_TYPES` is now a guard against a fossil enum value rather
 * than a rule about live data.
 *
 * The rows below are inserted by the service key, which is the only thing that
 * can still create one. That is the point: a guard nothing exercises is a guard
 * nobody notices removing, and the enum value cannot be dropped in Postgres.
 */

test("the tab lists events and never a digest, and the badge agrees", async ({
  browser,
}) => {
  const email = OWNER()
  const userId = await userIdByEmail(email)
  const { groupId, name } = await createCircleViaApi(email, "tab split")

  // One of each, both unread. The digest must be invisible in the tab and
  // uncounted by the badge; the event must be both.
  const digestId = await insertNotification(userId, "digest", {
    group_id: groupId,
    circle_name: name,
    date: (await checkinDateFor(email))!,
    completed_count: 1,
    member_count: 2,
    group_streak: 0,
  })
  const eventId = await insertNotification(userId, "invite_accepted", {
    group_id: groupId,
    circle_name: name,
    joined_username: "e2e_joiner",
  })

  const context = await browser.newContext({ storageState: await storageStateFor(email) })
  const page = await context.newPage()

  try {
    await page.goto("/dashboard/notifications")
    const panel = page.getByRole("region", { name: "Notifications" })

    // The event is listed.
    await expect(panel.getByText(/e2e_joiner joined/)).toBeVisible()

    // The digest is not — asserted on the wording only a digest produces, so
    // this cannot pass merely because the list is empty.
    await expect(panel.getByText(/finished on/)).toHaveCount(0)
    await expect(panel.getByText(/1 of 2/)).toHaveCount(0)

    // **And it stays unread.** Opening the tab marks read what the tab shows;
    // claiming otherwise is what the type filter on the action prevents.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("notifications")
          .select("read_at")
          .eq("id", digestId)
          .single()
        return data?.read_at
      })
      .toBeNull()

    // The event did get marked, which proves the filter did not simply disable
    // mark-read altogether.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("notifications")
          .select("read_at")
          .eq("id", eventId)
          .single()
        return data?.read_at
      })
      .not.toBeNull()
  } finally {
    await deleteNotifications([digestId, eventId])
    await deleteDigests(groupId)
    await context.close()
  }
})

test("an unread digest never lights the badge", async ({ browser }) => {
  const email = OWNER()
  const userId = await userIdByEmail(email)
  const { groupId, name } = await createCircleViaApi(email, "badge")

  const context = await browser.newContext({ storageState: await storageStateFor(email) })
  const page = await context.newPage()
  let digestId: string | null = null

  try {
    // Clear the slate through the app itself, so the baseline is whatever the
    // badge legitimately shows for this account.
    await page.goto("/dashboard/notifications")
    await page.goto("/dashboard")
    const before = await badgeCount(page)

    digestId = await insertNotification(userId, "digest", {
      group_id: groupId,
      circle_name: name,
      date: (await checkinDateFor(email))!,
      completed_count: 0,
      member_count: 2,
      group_streak: 0,
    })

    await page.reload()
    expect(await badgeCount(page), "a digest changed the badge").toBe(before)
  } finally {
    if (digestId) await deleteNotifications([digestId])
    await deleteDigests(groupId)
    await context.close()
  }
})

/**
 * Migration 112's standing invariant: nothing writes digest notifications.
 *
 * **Asserted over the whole table rather than over a fixture**, because the
 * failure this catches is a *reintroduction* — `build_daily_digests` growing
 * its member fan-out back, or a new caller deciding a digest deserves a row.
 * Either would show up here within a day of the nightly job running, and
 * nowhere else: the tab and the badge would keep hiding them exactly as the
 * tests above prove they do, which is what made the old shape survive so long.
 *
 * The two tests above insert their own and clean up in `finally`, so a run that
 * dies mid-test can leave one behind and fail this. That is the right trade: a
 * stray row is worth a red test.
 */
test("nothing writes digest notifications any more", async () => {
  const { count, error } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("type", "digest")

  expect(error?.message ?? null).toBeNull()
  expect(
    count,
    "a digest notification exists, so something is writing rows migration 112 removed",
  ).toBe(0)
})

/** The number beside the Notifications tab, or 0 when there is none. */
async function badgeCount(page: import("@playwright/test").Page): Promise<number> {
  const tab = page.getByRole("link", { name: /Notifications/ })
  const text = (await tab.first().innerText()).match(/\d+/)
  return text ? Number(text[0]) : 0
}
