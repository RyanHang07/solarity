import { test, expect, type Browser, type Page } from "@playwright/test"
import {
  checkinTimezone,
  createCircleViaApi,
  deleteE2ECircles,
  deleteNotifications,
  insertNotification,
  markUnread,
  requireEnv,
  setCheckinTimezone,
  setTodayScreenMode,
  todayScreenMode,
  unreadNotificationIds,
  unreadTabNotificationIds,
  userIdByEmail,
} from "./db"
import { storageStateFor } from "./session"
import { errorAlert } from "./ui"

/**
 * Step 8f: the dashboard's sections, the notifications reader, and settings.
 *
 * Three tabs when this was written; five since steps 15b and 16 added Profile
 * and Goals. The count is deliberately not in the prose — it has been wrong
 * twice.
 *
 * **The destructive one.** Opening the notifications tab marks every unread row
 * read, and the product offers no undo. These specs capture the unread set
 * first and restore it in a `finally`, so a real account ends the run as it
 * started. Anything added here that writes to a shared account needs the same
 * treatment.
 */

let ctx: { page: Page; close: () => Promise<void> } | null = null

/** One context for the file. Sessions are the scarce resource; see e2e/session.ts. */
async function ownerPage(browser: Browser) {
  if (ctx) return ctx.page
  const context = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
  })
  ctx = {
    page: await context.newPage(),
    close: async () => {
      await context.close()
      ctx = null
    },
  }
  return ctx.page
}

test.afterAll(async () => {
  await deleteE2ECircles()
  await ctx?.close()
})

test("every section is addressable, and an unknown tab lands on Overview", async ({
  browser,
}) => {
  const p = await ownerPage(browser)

  // **"Recent days", not "Your goals".** Overview stopped rendering a goals
  // region when the summary was removed: Today already lists every active goal
  // with its controls, so the summary was the same titles twice. The digest
  // panel is now the landmark that says this section rendered.
  await p.goto("/dashboard")
  await expect(p.getByRole("region", { name: "Recent days" })).toBeVisible()

  // The way out, and the only thing left of the summary. A tab bar link and a
  // page link are different affordances: this one is where the eye is when it
  // finishes reading Today.
  await expect(p.getByRole("link", { name: "View goals" })).toBeVisible()

  await p.goto("/dashboard/circles")
  await expect(p.getByRole("region", { name: "Your Circles" })).toBeVisible()
  // The create form travels with the list. Without it, a new account lands on a
  // Circles section with no way out of it, which reads as broken rather than
  // empty.
  await expect(p.getByLabel("Start a Circle")).toBeVisible()

  await p.goto("/dashboard/notifications")
  await expect(p.getByRole("region", { name: "Notifications" })).toBeVisible()

  // Steps 15b and 16 added two more. This test is the one place the whole tab
  // set is written down, so a section that stops resolving fails here rather
  // than in whichever spec happens to use it.
  await p.goto("/dashboard/goals")
  await expect(p.getByRole("region", { name: "Your goals" })).toBeVisible()

  await p.goto("/profile")
  await expect(p.getByRole("heading", { level: 1 })).toBeVisible()

  // An unknown value falls back rather than rendering nothing, matching
  // `/circles/[id]`. A section bar that renders blank for a stale bookmark is
  // worse than one that ignores it.
  await p.goto("/dashboard?tab=nonsense")
  await expect(p.getByRole("region", { name: "Recent days" })).toBeVisible()

  await expect(p.getByRole("link", { name: "Account settings" })).toBeVisible()
})

/**
 * Step 14a made the sections route segments. **Every URL written before that
 * still has to work**, because they are in bookmarks, in already-delivered
 * notifications, and in specs older than this one.
 */
test("the old ?tab= URLs still land on the right section", async ({ browser }) => {
  const p = await ownerPage(browser)

  await p.goto("/dashboard?tab=circles")
  await expect(p).toHaveURL(/\/dashboard\/circles$/)
  await expect(p.getByRole("region", { name: "Your Circles" })).toBeVisible()

  await p.goto("/dashboard?tab=notifications")
  await expect(p).toHaveURL(/\/dashboard\/notifications$/)
  await expect(p.getByRole("region", { name: "Notifications" })).toBeVisible()
})

/**
 * The requirement behind the route split: the bar is furniture.
 *
 * **Asserted by identity, not by appearance.** "The bar is visible on both
 * pages" would pass even if it were torn down and rebuilt, which is exactly the
 * failure this is about. Tagging the node and re-reading the tag after a
 * client-side navigation proves it is the *same* element — if Next re-rendered
 * the layout, the property would be gone.
 *
 * It also covers the trap: the active highlight is computed client-side from
 * `usePathname`, because a layout does not re-render on a sibling navigation
 * and a server-computed one would freeze on whichever section you arrived at.
 */
test("the section bar survives a navigation, and the highlight moves", async ({
  browser,
}) => {
  const p = await ownerPage(browser)
  await p.goto("/dashboard")

  const bar = p.getByRole("navigation").first()
  await expect(bar).toBeVisible()
  await bar.evaluate((node) => {
    ;(node as HTMLElement & { __solarity?: string }).__solarity = "same-node"
  })

  await expect(p.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  )

  // A click, not a `goto`. A full load would rebuild everything and prove
  // nothing about partial rendering.
  await p.getByRole("link", { name: "Circles", exact: true }).click()
  await expect(p).toHaveURL(/\/dashboard\/circles$/)
  await expect(p.getByRole("region", { name: "Your Circles" })).toBeVisible()

  await expect(
    await bar.evaluate(
      (node) => (node as HTMLElement & { __solarity?: string }).__solarity,
    ),
    "the section bar was re-mounted across a navigation",
  ).toBe("same-node")

  await expect(p.getByRole("link", { name: "Circles", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  )
  await expect(p.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
    "aria-current",
    "page",
  )
})

test("the badge counts unread, opening the tab clears it, and a reload keeps it clear", async ({
  browser,
}) => {
  const p = await ownerPage(browser)
  const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))

  // Captured before anything is read, and put back at the end. These are a real
  // person's rows.
  const wasUnread = await unreadNotificationIds(ownerId)
  const mine: string[] = []

  try {
    const { groupId, name } = await createCircleViaApi(
      requireEnv("E2E_OWNER_EMAIL"),
      "notif",
    )
    // **An event type, not a digest, since 11c.** The badge counts the four
    // types the tab owns; a digest is a delivery queue row that the tab never
    // renders and the badge never counts. This test used a digest until step 12
    // caught it — and it had been passing on the owner's *real* unread rows,
    // which is the worst way for a test to be wrong, because it is green
    // whenever the account happens to be untidy.
    mine.push(
      await insertNotification(ownerId, "invite_accepted", {
        group_id: groupId,
        circle_name: name,
        joined_username: "e2e_joiner",
      }),
    )

    await p.goto("/dashboard")
    const badge = p.getByRole("link", { name: /^Notifications \(\d+\)$/ })
    await expect(badge, "no unread count on the tab").toBeVisible()

    await badge.click()
    await expect(p.getByText(`e2e_joiner joined ${name}`)).toBeVisible()

    // Asserted at the database, not by the badge disappearing. The write is the
    // claim; the label is a rendering of it, and a label that clears because the
    // query broke would pass an assertion about the label.
    //
    // **Scoped to the tab's own types, since 11c.** A `digest` is never
    // rendered here and is never marked read, so it stays unread for the life
    // of the account. Polling *all* unread rows to zero was an assertion that
    // could only pass on an account with no digest history at all — which is to
    // say, briefly, and then never again.
    await expect
      .poll(async () => (await unreadTabNotificationIds(ownerId)).length, {
        message: "opening the tab did not mark anything read",
        timeout: 10_000,
      })
      .toBe(0)

    await p.reload()
    await expect(
      p.getByRole("link", { name: "Notifications" }),
      "the badge came back after a reload",
    ).toBeVisible()
  } finally {
    await deleteNotifications(mine)
    await markUnread(wasUnread)
    await deleteE2ECircles()
  }
})

test("a notification renders without its Circle, and an unknown type has a fallback", async ({
  browser,
}) => {
  const p = await ownerPage(browser)
  const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))

  const wasUnread = await unreadNotificationIds(ownerId)
  const mine: string[] = []

  try {
    // A Circle id that does not exist. Reachable in production because
    // `payload.group_id` is a jsonb value with no foreign key, so deleting a
    // Circle orphans every notification about it. Only the service key can
    // produce this state, since deleting a Circle is not a UI path.
    //
    // **`deadline_changed`, not `digest`, since 11c.** The tab filters by type,
    // so a digest planted here is invisible and the assertion below could only
    // ever fail. The orphan case is what is being tested, and it belongs to
    // whichever types the tab actually renders.
    mine.push(
      await insertNotification(ownerId, "deadline_changed", {
        group_id: "00000000-0000-0000-0000-000000000000",
        circle_name: "E2E GHOST CIRCLE",
      }),
    )

    // A type the app has never had to render, forced with the service key.
    //
    // All five types do have writers: `group_locked_renewal` comes from
    // `run_daily_rollover` when a deadline passes, and `deadline_changed` from
    // `set_circle_deadline`. Neither is reachable from a test in a sensible
    // amount of time, and both were unrendered until 8f, so this is the branch
    // that proves they render at all.
    const { groupId, name } = await createCircleViaApi(
      requireEnv("E2E_OWNER_EMAIL"),
      "fallback",
    )
    mine.push(
      await insertNotification(ownerId, "group_locked_renewal", {
        group_id: groupId,
        circle_name: name,
      }),
    )

    await p.goto("/dashboard/notifications")

    const ghost = p.getByRole("listitem").filter({ hasText: "E2E GHOST CIRCLE" })
    await expect(ghost).toBeVisible()
    await expect(ghost.getByText("(no longer available)")).toBeVisible()
    // Not a link: it would land on a Circle that is gone.
    await expect(ghost.getByRole("link")).toHaveCount(0)

    await expect(p.getByText(`${name} has finished its cycle`)).toBeVisible()

    // Nothing raw from the payload is rendered. `type` and `payload` are
    // database values, and a branch that prints one is how an enum name reaches
    // a screen.
    //
    // **Asserted on the rendered text, not on `page.content()`.** The RSC
    // stream embeds every prop in a `<script>` tag, so the raw `type` and the
    // whole payload are in the document whatever the screen shows, and the
    // first version of this failed on its own serialisation. `page.content()`
    // is the right tool for "this string must never reach the browser", as in
    // `roster.spec`; it is the wrong one for "this string must not be shown".
    await expect(p.getByRole("region", { name: "Notifications" })).not.toContainText(
      "group_locked_renewal",
    )
  } finally {
    await deleteNotifications(mine)
    await markUnread(wasUnread)
    await deleteE2ECircles()
  }
})

test("a Circle with no finished day is absent from Overview, not blank in it", async ({
  browser,
}) => {
  const p = await ownerPage(browser)

  try {
    const { name } = await createCircleViaApi(requireEnv("E2E_OWNER_EMAIL"), "digest")

    await p.goto("/dashboard")

    /**
     * **This assertion inverted in step 11, deliberately.**
     *
     * The old panel showed one row per Circle and gave a brand-new one the line
     * "no day has finished yet", so that Overview could not disagree with the
     * Circles tab. The panel is now one box per *day*, and a day box lists the
     * Circles that reported that day — a Circle with no snapshot has nothing to
     * put in any box, and inventing a row for it would mean inventing a day.
     *
     * The guarantee it was protecting still holds, just somewhere else: the
     * Circles tab is where the full list lives, and the assertion below says so
     * rather than trusting it.
     */
    const panel = p.getByRole("region", { name: "Recent days" })
    await expect(panel.getByTestId("digest-circle").filter({ hasText: name })).toHaveCount(0)

    // And it is not lost: the tab that owns the list still has it.
    await p.goto("/dashboard/circles")
    await expect(p.getByText(name).first()).toBeVisible()
  } finally {
    await deleteE2ECircles()
  }
})

test("a deliberate timezone change is queued, not applied to today", async ({
  browser,
}) => {
  const p = await ownerPage(browser)
  const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))

  // **Restored in a `finally`, without exception.** `checkin_timezone` decides
  // what "today" is, and leaving this account on the wrong one would break
  // every check-in date assertion in the suite, in files that never mention
  // timezones.
  const original = await checkinTimezone(ownerId)

  try {
    await p.goto("/settings")
    await expect(p.getByRole("heading", { name: "Settings" })).toBeVisible()

    const tzForm = p.getByRole("form", { name: "Check-in timezone" })
    const field = tzForm.getByLabel("Check-in timezone")
    await expect(field).toHaveValue(original.live)

    await field.fill("Asia/Tokyo")
    await tzForm.getByRole("button", { name: "Save" }).click()

    // Wait for the *pending* paragraph, which only renders when the server says
    // something is queued.
    //
    // The first version waited for the confirmation text, which overlapped the
    // static helper copy below the field, so it matched immediately, the button
    // still read "Saving…", and the database read below ran mid-flight. An
    // assertion that can pass before the action starts is not a wait.
    await expect(tzForm.getByText(/takes over at your next daily reset/i)).toBeVisible()

    // ---------------------------------------------------------------------
    // The assertion this whole design exists for.
    //
    // `checkin_date_for` derives today from `checkin_timezone` and `now()`
    // alone, never from `checkin_day_started_at`, so writing the live column
    // here would re-date today: check-ins already made would sit under a date
    // that is no longer today, and completion would read as nothing done.
    //
    // This is what fails if anyone later "simplifies" the pending column away.
    // ---------------------------------------------------------------------
    const saved = await checkinTimezone(ownerId)
    expect(saved.pending, "the chosen zone was not queued").toBe("Asia/Tokyo")
    expect(saved.live, "the live zone moved, so today has been re-dated").toBe(
      original.live,
    )

    // Both facts on screen: what is in force, and what is coming.
    await expect(tzForm.getByText(new RegExp(original.live))).toBeVisible()

    // Choosing the zone already in force cancels rather than queueing a change
    // to the current value, so "put it back" leaves nothing pending.
    await field.fill(original.live)
    await tzForm.getByRole("button", { name: "Save" }).click()
    await expect(tzForm.getByText(/takes over at your next daily reset/i)).toHaveCount(0)
    expect(
      (await checkinTimezone(ownerId)).pending,
      "re-choosing the current zone left something queued",
    ).toBeNull()

    // The database refuses a name it does not know, rather than storing it and
    // failing at 2 AM.
    await field.fill("Not/AZone")
    await tzForm.getByRole("button", { name: "Save" }).click()
    // `errorAlert` rather than `getByRole("alert")`: the dev overlay's empty
    // alert node is page-wide, and an alert saying nothing is not a refusal
    // being shown. Latent here rather than failing, but the same trap that made
    // the sign-in spec read the wrong element.
    await expect(errorAlert(p)).toBeVisible()
    expect((await checkinTimezone(ownerId)).live).toBe(original.live)
  } finally {
    // ---------------------------------------------------------------------
    // Wait for the form to go idle before restoring.
    //
    // **Cleanup can race a server action.** When this test failed earlier, the
    // assertion threw while the save was still in flight; `finally` restored
    // the row, and the action then completed and wrote its value back *after*
    // the restore. The account was left with `Asia/Tokyo` queued by a test that
    // had already reported cleaning up after itself.
    //
    // A disabled Save button means a submission is still running, so this waits
    // for one that is enabled. `finally` runs on the failure path too, which is
    // exactly the path where something is likely still in flight.
    // ---------------------------------------------------------------------
    await p
      .getByRole("form", { name: "Check-in timezone" })
      .getByRole("button", { name: "Save" })
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => {})
    await setCheckinTimezone(ownerId, original)
  }
})

test("the daily check-in screen setting saves, and says what it does not do", async ({
  browser,
}) => {
  const p = await ownerPage(browser)
  const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))

  // A real account's preference. Captured and restored like the timezone.
  const original = await todayScreenMode(ownerId)

  try {
    await p.goto("/settings")
    const form = p.getByRole("form", { name: "Daily check-in screen" })

    await expect(form.getByRole("radio", { checked: true })).toHaveCount(1)

    await form.getByRole("radio", { name: "Never" }).check()
    await form.getByRole("button", { name: "Save" }).click()

    await expect
      .poll(async () => todayScreenMode(ownerId), {
        message: "the mode was not saved",
      })
      .toBe("never")

    // The setting reads as more aggressive than it is, so the screen says what
    // none of the three options do.
    await expect(
      form.getByText(/finished day always goes straight to your dashboard/i),
    ).toBeVisible()

    // And it survives a reload, which is what proves the checked radio comes
    // from the server rather than from the click.
    await p.reload()
    await expect(
      p
        .getByRole("form", { name: "Daily check-in screen" })
        .getByRole("radio", { name: "Never" }),
    ).toBeChecked()
  } finally {
    await setTodayScreenMode(ownerId, original)
  }
})
