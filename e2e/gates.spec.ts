import { test, expect, type Browser, type Page } from "@playwright/test"
import {
  admin,
  checkinDateFor,
  ensureUnfinishedDay,
  requireEnv,
  parkActiveGoals,
  parkCompletionHistory,
  restoreGoalSlots,
  restoreParkedGoals,
  seedCompletedDays,
  setTodayScreenMode,
  todayScreenMode,
  userIdByEmail,
} from "./db"
import { storageStateFor } from "./session"

/**
 * The redirect gates, and where each one lives.
 *
 * Written before step 9 builds `/today`, because the two gates have to be in
 * different places and the reason is structural rather than a matter of taste.
 *
 * ```
 * app/
 *   onboarding/page.tsx      <- OUTSIDE the (app) group
 *   (app)/
 *     layout.tsx             <- the onboarding gate lives here
 *     dashboard/page.tsx     <- the /today gate belongs HERE, not in the layout
 *     today/page.tsx         (step 9b)
 * ```
 *
 * **Why `/onboarding` can be the target of a gate in `(app)/layout.tsx`:** it is
 * not inside `(app)`, so the layout never runs for it. Nothing to loop.
 *
 * **Why `/today` cannot be.** It *will* live inside `(app)`, so a second
 * condition in that layout would fire on `/today` itself and redirect it to
 * `/today` forever. The check-in gate belongs on `/dashboard`, which is the
 * screen it is diverting people away from, and nowhere else.
 *
 * This file exists to make that difference a test rather than a comment.
 *
 * **Destructive.** One spec nulls a real account's username to prove the gate
 * fires, and puts it back in a `finally` and again in `afterAll`. Without a
 * username the account cannot reach any signed-in screen, so a leak here is
 * worse than a stray Circle.
 */

const GATED = ["/dashboard", "/dashboard/circles", "/settings"] as const

let ctx: { page: Page; close: () => Promise<void> } | null = null

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

/** Reads it straight from the row, because RLS would hide a null from its owner. */
async function usernameOf(userId: string) {
  const { data, error } = await admin
    .from("users")
    .select("username")
    .eq("id", userId)
    .single()
  if (error) throw error
  return data.username
}

async function setUsername(userId: string, username: string | null) {
  const { error } = await admin.from("users").update({ username }).eq("id", userId)
  if (error) throw error
}

let restoreUsername: (() => Promise<void>) | null = null

test.afterAll(async () => {
  // Belt and braces. `finally` does not run when Playwright kills a test on
  // timeout, and the failure mode here is an account that cannot sign in.
  if (restoreUsername) await restoreUsername()
  await ctx?.close()
})

test("an onboarded account passes every gate", async ({ browser }) => {
  const p = await ownerPage(browser)

  for (const route of GATED) {
    await p.goto(route)
    await expect(p, `${route} redirected an onboarded account`).toHaveURL(
      new RegExp(route.split("?")[0].replace("/", "\\/")),
    )
  }
})

test("/onboarding sends a finished account back to the dashboard", async ({
  browser,
}) => {
  const p = await ownerPage(browser)

  // The reverse gate. Renaming happens in settings; onboarding is for accounts
  // that have never had a username, and re-entering it would offer a second
  // rename path that skips the 14-day limit.
  await p.goto("/onboarding")
  await expect(p).toHaveURL(/\/dashboard/)
})

test("without a username, every (app) route bounces and /onboarding renders", async ({
  browser,
}) => {
  const p = await ownerPage(browser)
  const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
  const original = await usernameOf(ownerId)
  if (!original) throw new Error("the owner account has no username to restore")

  restoreUsername = () => setUsername(ownerId, original)

  try {
    await setUsername(ownerId, null)

    for (const route of GATED) {
      await p.goto(route)
      await expect(p, `${route} did not bounce an account with no username`).toHaveURL(
        /\/onboarding/,
      )
    }

    // And the destination itself renders rather than bouncing back. This is the
    // half that would loop if `/onboarding` were inside `(app)`.
    await p.goto("/onboarding")
    await expect(p).toHaveURL(/\/onboarding$/)
    await expect(p.getByRole("heading", { name: /welcome/i })).toBeVisible()

    // No app chrome, which is the structural proof rather than a styling
    // detail: the header lives in `(app)/layout.tsx`, so its absence is what
    // "outside the group" looks like from the browser.
    await expect(p.getByRole("button", { name: "Sign out" })).toHaveCount(0)
  } finally {
    await setUsername(ownerId, original)
    restoreUsername = null
  }
})

/**
 * Step 9b: the check-in gate.
 *
 * **Every test here runs in its own context.** The gate is driven by cookies,
 * and the file's shared page carries whichever ones the previous test left.
 * They share a session through `storageStateFor`, so this costs no extra mint.
 */
test.describe("the check-in gate", () => {
  /**
   * Every test below needs the account to have something left to do today, and
   * none of them used to say so.
   *
   * **Six failed at once the day the account's goals were all checked off by
   * hand.** They were asserting on a fact about the account rather than about a
   * fixture, and it had simply been true for months. The cascade was sharper
   * than that: `a finished day` parks and restores every goal, which recounts
   * `daily_completion` — so it *corrected* a stale row mid-file, and every test
   * after it inherited the corrected, finished day. Third instance of the same
   * pattern, and the first where the trigger was another test's cleanup.
   *
   * One unchecked goal is the whole fixture. `hasUnfinishedDay` needs an active
   * goal and an incomplete day, and a goal nobody has checked off is both.
   */
  let undoUnfinished: (() => Promise<void>) | null = null

  test.beforeEach(async () => {
    undoUnfinished = await ensureUnfinishedDay(
      await userIdByEmail(requireEnv("E2E_OWNER_EMAIL")),
    )
  })

  test.afterEach(async () => {
    await undoUnfinished?.()
    undoUnfinished = null
  })

  /**
   * Back to `never` when this file is done.
   *
   * `auth.setup.ts` opts both accounts out for the whole run, because an
   * unfinished day would otherwise divert every other spec's `/dashboard`
   * navigation. These tests are the exception, and they have to put it back.
   */
  test.afterAll(async () => {
    await setTodayScreenMode(
      await userIdByEmail(requireEnv("E2E_OWNER_EMAIL")),
      "never",
    )
    // The net for `withNoActiveGoals`. `afterAll` still runs after a timeout;
    // `finally` does not.
    await restoreParkedGoals()
  })

  /** A page with no cookies but the auth ones, so the gate starts from nothing. */
  async function freshPage(browser: Browser) {
    const context = await browser.newContext({
      storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
    })
    return { page: await context.newPage(), close: () => context.close() }
  }

  /**
   * A finished day, fabricated by leaving no active goals.
   *
   * `hasUnfinishedDay` returns false when there is nothing active — which is
   * also the guard that stops someone with no goals being diverted to an empty
   * screen every day — so this is the only way to reach the finished branch
   * without earning it.
   *
   * **Uses `parkActiveGoals`, not its own archive loop.** The first version
   * here re-implemented that helper and left out the part that matters: the
   * journal. A Playwright timeout kills a test without running `finally`, and
   * the failure mode is a real account with every goal archived. `db.ts` writes
   * the ids to `e2e/.auth/parked-goals.json` before touching anything, and
   * `npm run test:e2e:clean` restores from it.
   */
  async function withNoActiveGoals<T>(userId: string, body: () => Promise<T>) {
    const parked = await parkActiveGoals(userId)
    try {
      return await body()
    } finally {
      await restoreGoalSlots(parked)
    }
  }

  test("/today never redirects to itself", async ({ browser }) => {
    const { page, close } = await freshPage(browser)
    try {
      await page.goto("/today")
      await expect(page, "the gate is in the layout, so /today looped").toHaveURL(
        /\/today$/,
      )
      await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()
    } finally {
      await close()
    }
  })

  test("an unfinished day diverts the dashboard, then stops", async ({ browser }) => {
    const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
    await setTodayScreenMode(ownerId, "once_daily")

    const { page, close } = await freshPage(browser)
    try {
      await page.goto("/dashboard")
      await expect(page, "an unfinished day did not divert").toHaveURL(/\/today$/)

      // The mark-seen action fires after the page paints, so the second visit
      // has to wait for the cookie rather than assume it.
      await expect
        .poll(
          async () => {
            await page.goto("/dashboard")
            return new URL(page.url()).pathname
          },
          { message: "the dashboard kept diverting after /today was shown" },
        )
        .toBe("/dashboard")
    } finally {
      await close()
    }
  })

  test("a finished day never diverts, and /today hands you back", async ({
    browser,
  }) => {
    const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
    await setTodayScreenMode(ownerId, "once_daily")

    await withNoActiveGoals(ownerId, async () => {
      const { page, close } = await freshPage(browser)
      try {
        await page.goto("/dashboard")
        await expect(page).toHaveURL(/\/dashboard/)

        // And going there deliberately is not a way to see an empty list — but
        // it says why rather than silently landing you somewhere else.
        await page.goto("/today")
        await expect(page).toHaveURL(/notice=day-done/)
        await expect(page.getByText(/everything's checked off for today/i)).toBeVisible()
      } finally {
        await close()
      }
    })
  })

  test("`never` does not divert, and /today is still reachable", async ({
    browser,
  }) => {
    const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
    const original = await todayScreenMode(ownerId)

    try {
      await setTodayScreenMode(ownerId, "never")
      const { page, close } = await freshPage(browser)
      try {
        await page.goto("/dashboard")
        await expect(page, "`never` still diverted").toHaveURL(/\/dashboard/)

        // `never` turns off the diversion, not the screen.
        await page.goto("/today")
        await expect(page).toHaveURL(/\/today$/)
      } finally {
        await close()
      }
    } finally {
      await setTodayScreenMode(ownerId, original)
    }
  })

  test("`every_open` diverts once per session, not once per day", async ({
    browser,
  }) => {
    const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
    const original = await todayScreenMode(ownerId)

    try {
      await setTodayScreenMode(ownerId, "every_open")

      const first = await freshPage(browser)
      try {
        await first.page.goto("/dashboard")
        await expect(first.page).toHaveURL(/\/today$/)
        await expect
          .poll(async () => {
            await first.page.goto("/dashboard")
            return new URL(first.page.url()).pathname
          })
          .toBe("/dashboard")
      } finally {
        await first.close()
      }

      // A new context is a new browser session, which is exactly what the
      // session cookie is for. `once_daily` would still be suppressed here.
      const second = await freshPage(browser)
      try {
        await second.page.goto("/dashboard")
        await expect(
          second.page,
          "`every_open` did not divert in a new session",
        ).toHaveURL(/\/today$/)
      } finally {
        await second.close()
      }
    } finally {
      await setTodayScreenMode(ownerId, original)
    }
  })

  test("the day cookie names a check-in date, so midnight does not release it", async ({
    browser,
  }) => {
    const ownerId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
    await setTodayScreenMode(ownerId, "once_daily")

    const { page, close } = await freshPage(browser)
    try {
      await page.goto("/dashboard")
      await expect(page).toHaveURL(/\/today$/)
      await expect
        .poll(async () => {
          await page.goto("/dashboard")
          return new URL(page.url()).pathname
        })
        .toBe("/dashboard")

      // The suppression is a date comparison, not a timer.
      //
      // Asserted on the cookie's **value** rather than by moving a clock: the
      // check-in date is computed in Postgres from the user's timezone, and
      // `page.clock` moves only the browser's. A cookie holding today's date
      // cannot suppress tomorrow, whatever hour the browser thinks it is.
      const cookie = (await page.context().cookies()).find(
        (c) => c.name === "solarity_today_seen",
      )
      expect(cookie, "no day cookie was set").toBeDefined()
      expect(cookie?.value, "the cookie is not a check-in date").toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      )
    } finally {
      await close()
    }
  })
})

/**
 * Steps 9c and 9d: what `/today` shows once you are on it.
 *
 * Separate from the gate tests because these are about the screen rather than
 * about who reaches it, and because every one of them fabricates history.
 */
test.describe("the today screen", () => {
  /**
   * One unchecked goal, for the same reason as the check-in gate above: these
   * tests need `/today` to have something to show, and inheriting that from the
   * account is what broke six of them at once.
   */
  let undoUnfinished: (() => Promise<void>) | null = null

  test.beforeEach(async () => {
    undoUnfinished = await ensureUnfinishedDay(
      await userIdByEmail(requireEnv("E2E_OWNER_EMAIL")),
    )
  })

  test.afterEach(async () => {
    await undoUnfinished?.()
    undoUnfinished = null
  })

  test.afterAll(async () => {
    await setTodayScreenMode(
      await userIdByEmail(requireEnv("E2E_OWNER_EMAIL")),
      "never",
    )
  })

  /** Days counted backwards from a check-in date, newest first. */
  function daysBefore(from: string, count: number, gap = 1): string[] {
    const out: string[] = []
    const d = new Date(`${from}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - gap)
    for (let i = 0; i < count; i++) {
      out.push(d.toISOString().slice(0, 10))
      d.setUTCDate(d.getUTCDate() - 1)
    }
    return out
  }

  test("a broken streak names its length and the day it ended", async ({
    browser,
  }) => {
    const email = requireEnv("E2E_OWNER_EMAIL")
    const ownerId = await userIdByEmail(email)
    const today = await checkinDateFor(email)

    // The account's own history goes away first. Without that, a real
    // completed day immediately before the seeded run extends it and the header
    // reads four instead of three — which is what happened, and is the reason
    // this parks rather than merely seeding.
    const restore = await parkCompletionHistory(ownerId)

    // Three consecutive completed days, ending the day before yesterday. The
    // gap is what makes the run broken rather than live.
    const run = daysBefore(today, 3, 2)
    await seedCompletedDays(ownerId, run)

    const context = await browser.newContext({
      storageState: await storageStateFor(email),
    })
    try {
      const page = await context.newPage()
      await page.goto("/today")

      // The length and the end date, neither of which is stored anywhere:
      // `current_streak` is already 0 and the rollover recorded nothing about
      // what it zeroed. Both come from walking `daily_completion` backwards.
      await expect(page.getByText(/3 days run ended on/i)).toBeVisible()
      await expect(page.getByRole("heading", { name: "Today" })).toBeVisible()

      // And never a bare zero, which after a fortnight reads as a bug.
      await expect(page.getByText(/^0 days/)).toHaveCount(0)
    } finally {
      await context.close()
      await restore()
    }
  })

  test("no history at all invites rather than reporting zero", async ({ browser }) => {
    const email = requireEnv("E2E_OWNER_EMAIL")
    const ownerId = await userIdByEmail(email)

    // Emptied rather than assumed empty. The account has real history, and
    // "never completed a day" is a state a test has to create.
    const restore = await parkCompletionHistory(ownerId)

    const context = await browser.newContext({
      storageState: await storageStateFor(email),
    })
    try {
      const page = await context.newPage()
      await page.goto("/today")

      await expect(page.getByText(/day one/i)).toBeVisible()
      await expect(page.getByText(/^0 days/)).toHaveCount(0)
    } finally {
      await context.close()
      await restore()
    }
  })

  test("checking off from /today writes the same rows as the dashboard", async ({
    browser,
  }) => {
    const email = requireEnv("E2E_OWNER_EMAIL")
    const ownerId = await userIdByEmail(email)
    const today = await checkinDateFor(email)

    const context = await browser.newContext({
      storageState: await storageStateFor(email),
    })
    let entryId: string | null = null

    try {
      const page = await context.newPage()
      await page.goto("/today")

      // ---------------------------------------------------------------------
      // Found by its button, then re-found by its title.
      //
      // **A locator must not describe the state the click changes.** Filtering
      // on `has: button "Check in"` stops matching the moment the button
      // becomes "Undo", so the follow-up assertion resolves to nothing and
      // reports as a missing Undo rather than as a successful check-in. Same
      // trap as the `expanded: false` filter in `roster.spec`.
      // ---------------------------------------------------------------------
      const unchecked = page
        .getByRole("listitem")
        .filter({ has: page.getByRole("button", { name: "Check in" }) })
        .first()
      const title = (await unchecked.innerText()).split("\n")[0].trim()

      await unchecked.getByRole("button", { name: "Check in" }).click()

      const row = page.getByRole("listitem").filter({ hasText: title })
      await expect(row.getByRole("button", { name: "Undo" })).toBeVisible()

      // Asserted at the database. The panel is shared with the dashboard, so
      // the claim worth making is that the row landed, not that a button
      // changed label.
      const { data } = await admin
        .from("progress_entries")
        .select("id, goals(title)")
        .eq("user_id", ownerId)
        .eq("check_in_date", today)
      const written = (data ?? []).find((e) => e.goals?.title === title)
      expect(written, `no check-in row for "${title}"`).toBeDefined()
      entryId = written?.id ?? null
    } finally {
      if (entryId) await admin.from("progress_entries").delete().eq("id", entryId)
      await context.close()
    }
  })

  test("the settings link lands on the control, not the top of the page", async ({
    browser,
  }) => {
    const email = requireEnv("E2E_OWNER_EMAIL")
    const context = await browser.newContext({
      storageState: await storageStateFor(email),
    })
    try {
      const page = await context.newPage()
      await page.goto("/today")
      await page.getByRole("link", { name: /change how often/i }).click()

      await expect(page).toHaveURL(/\/settings#check-in-screen$/)
      // The fragment has to name something that exists, or it silently does
      // nothing and the link looks like it works.
      await expect(page.locator("#check-in-screen")).toBeVisible()
      await expect(
        page.getByRole("form", { name: "Daily check-in screen" }),
      ).toBeVisible()
    } finally {
      await context.close()
    }
  })
})

/** Step 9e: the two ways off `/today`, and what each one says. */
test.describe("leaving today", () => {
  /**
   * One unchecked goal, for the same reason as the check-in gate above: these
   * tests need `/today` to have something to show, and inheriting that from the
   * account is what broke six of them at once.
   */
  let undoUnfinished: (() => Promise<void>) | null = null

  test.beforeEach(async () => {
    undoUnfinished = await ensureUnfinishedDay(
      await userIdByEmail(requireEnv("E2E_OWNER_EMAIL")),
    )
  })

  test.afterEach(async () => {
    await undoUnfinished?.()
    undoUnfinished = null
  })

  test.afterAll(async () => {
    await setTodayScreenMode(
      await userIdByEmail(requireEnv("E2E_OWNER_EMAIL")),
      "never",
    )
  })

  test("skipping lands on the dashboard, silently, and does not divert back", async ({
    browser,
  }) => {
    const email = requireEnv("E2E_OWNER_EMAIL")
    const ownerId = await userIdByEmail(email)
    await setTodayScreenMode(ownerId, "once_daily")

    const context = await browser.newContext({
      storageState: await storageStateFor(email),
    })
    try {
      const page = await context.newPage()
      await page.goto("/dashboard")
      await expect(page).toHaveURL(/\/today$/)

      await page.getByRole("button", { name: "Skip for now" }).click()
      await expect(page).toHaveURL(/\/dashboard$/)

      // No notice. Skipping is not an achievement and not an error, and a
      // message about what you just chose to do is one people learn to ignore.
      //
      // **Asserted on the notice's own words, not on `role=alert`.** Next's dev
      // overlay renders an empty alert node on every page, so the role matches
      // once regardless — the same trap as its dev-tools button matching
      // `getByRole("button")` in `roster.spec`.
      await expect(page.getByText(/everything's checked off for today/i)).toHaveCount(0)
      await expect(page).not.toHaveURL(/notice=/)

      // The skip also marks it seen, so going back to the dashboard does not
      // bounce you straight in again. That is the loop the "mark on show, not
      // on dismiss" decision was already guarding, from the other side.
      await page.goto("/dashboard")
      await expect(page).toHaveURL(/\/dashboard$/)
    } finally {
      await context.close()
    }
  })
})
