import { test, expect } from "@playwright/test"
import { admin, requireEnv, userIdByEmail } from "./db"
import { storageStateFor } from "./session"

/**
 * Step 10c. The permission screen, and the promises it must not break.
 *
 * ## What a browser test can reach here, and what it cannot
 *
 * Playwright can **grant** a permission to a context, and it does not help:
 * headless Chromium reports `Notification.permission === "denied"` anyway. The
 * dialog is not something a headless browser has, so it is the manual pass, and
 * these tests own everything around it:
 *
 * | Reachable here | Manual, on a device |
 * |---|---|
 * | the screen never asks on render | whether the dialog reads well enough to earn a yes |
 * | a decline is an ending, not an error | whether iOS delivers to an installed PWA |
 * | a blocked browser gets help, not a dead switch | |
 * | a failure is never dressed up as success | |
 *
 * A denial is simulated by replacing `window.Notification` before any page
 * script runs. That tests our branch rather than the browser's, which is the
 * honest limit and is exactly the part that could regress.
 *
 * **Writes.** One test can leave a real `push_subscriptions` row if headless
 * Chromium reaches its push service; it deletes the account's rows afterwards
 * either way.
 */

const PATH = "/onboarding/notifications"

/** A `Notification` whose permission is already `denied`, planted pre-hydration. */
const DENIED = `
  window.Notification = function () {};
  Object.defineProperty(window.Notification, 'permission', { get: () => 'denied' });
  window.Notification.requestPermission = function () {
    throw new Error('asked after a permanent denial');
  };
`

/** Granted, but the ask still has to come from the button. */
const GRANTED_COUNTING = `
  window.__askCount = 0;
  window.Notification = function () {};
  Object.defineProperty(window.Notification, 'permission', { get: () => 'granted' });
  window.Notification.requestPermission = function () {
    window.__askCount++;
    return Promise.resolve('granted');
  };
`

/** The dialog closed with no answer. Nothing is spent, so this is not a failure. */
const DISMISSED = `
  window.Notification = function () {};
  Object.defineProperty(window.Notification, 'permission', { get: () => 'default' });
  window.Notification.requestPermission = function () {
    return Promise.resolve('default');
  };
`

async function signedIn(browser: import("@playwright/test").Browser, init?: string) {
  const context = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
  })
  if (init) await context.addInitScript(init)
  const page = await context.newPage()
  return { page, close: () => context.close() }
}

test("the screen explains before it asks, and never asks on render", async ({
  browser,
}) => {
  const { page, close } = await signedIn(browser, GRANTED_COUNTING)
  await page.goto(PATH)

  await expect(
    page.getByRole("heading", { name: "Get a nudge when it matters" }),
  ).toBeVisible()

  // The whole reason this screen exists. One ask per browser, and a denial is
  // permanent, so a render must never spend it.
  await expect
    .poll(() => page.evaluate(() => window.__askCount))
    .toBe(0)

  await expect(page.getByRole("button", { name: "Turn on notifications" })).toBeVisible()

  await close()
})

test("a blocked browser gets help rather than a switch that cannot work", async ({
  browser,
}) => {
  const { page, close } = await signedIn(browser, DENIED)
  await page.goto(PATH)

  await expect(page.getByText(/blocking notifications for Solarity/i)).toBeVisible()

  // Not a toggle. There is nothing this page can do about a denial, and a
  // control that silently fails is worse than none.
  await expect(page.getByRole("button", { name: "Turn on notifications" })).toHaveCount(0)

  // Four links, and no sentence naming a browser we have not identified.
  await expect(page.getByRole("link", { name: /How to do it in/i })).toHaveCount(4)

  await close()
})

test("skipping is an ending, not an error", async ({ browser }) => {
  const { page, close } = await signedIn(browser, DISMISSED)
  await page.goto(PATH)

  await page.getByRole("button", { name: "Not now" }).click()
  await expect(page).toHaveURL(/\/(dashboard|today)/)

  await close()
})

test("closing the dialog without answering says so, and changes nothing", async ({
  browser,
}) => {
  const { page, close } = await signedIn(browser, DISMISSED)
  await page.goto(PATH)

  await page.getByRole("button", { name: "Turn on notifications" }).click()

  await expect(page.getByText(/nothing has changed/i)).toBeVisible()
  // Still offered, because the browser will still ask. A dismissal spends
  // nothing.
  await expect(page.getByRole("button", { name: "Turn on notifications" })).toBeVisible()

  await close()
})

test("a granted browser either subscribes or says why, and never pretends", async ({
  browser,
}) => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))

  // **`permissions: ["notifications"]` is not enough, which cost a run to
  // learn.** Playwright grants it, and headless Chromium still reports
  // `Notification.permission === "denied"`, so the page correctly rendered the
  // blocked branch and the button this test wanted never existed. The
  // permission dialog is simply not a thing that exists in a headless browser.
  //
  // So the *answer* is stubbed and everything after it is real: the actual
  // `pushManager`, the actual RPC, the actual row. That is the half worth
  // testing, and it is the half that can regress.
  const { page, close } = await signedIn(browser, GRANTED_COUNTING)

  // **Cleared first, not only afterwards.** This used to assert an
  // account-wide count, which conflates "this click wrote a row" with "this
  // account has a row from something else", and it failed exactly that way:
  // the failure UI with a count of 1. A test that cannot tell its own write
  // from a leftover is not evidence.
  await admin.from("push_subscriptions").delete().eq("user_id", userId)

  try {
    await page.goto(PATH)
    await page.getByRole("button", { name: "Turn on notifications" }).click()

    // Headless Chromium usually cannot reach a push service, so a failure here
    // is expected and legitimate. What is never legitimate is a third ending:
    // the success heading with no row behind it.
    const success = page.getByRole("heading", { name: "Notifications are on" })
    // **Not `getByRole("alert")`.** Next's dev overlay renders an empty alert
    // node on every page, which matched a previous test and made it pass for
    // the wrong reason. This names the paragraph the screen actually renders
    // and requires it to say something.
    const failure = page.locator('p[role="alert"]').filter({ hasText: /\S/ })
    await expect(success.or(failure)).toBeVisible({ timeout: 20_000 })

    // The endpoint this browser actually holds, so the row is matched to the
    // click rather than to the account. `null` when the push service refused,
    // which is the ordinary headless case.
    const endpoint = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      return sub?.endpoint ?? null
    })

    const rowsForThisBrowser = endpoint
      ? await admin
          .from("push_subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("endpoint", endpoint)
          .then((r) => r.count ?? 0)
      : 0

    if (await success.isVisible()) {
      expect(rowsForThisBrowser).toBeGreaterThan(0)
      // Said only where it is true.
      await expect(page.getByText(/turn this off in settings/i)).toBeVisible()
    } else {
      // No claim about the account, only about this browser: if the screen
      // reported a failure, this endpoint must not be registered.
      expect(rowsForThisBrowser).toBe(0)
      // A failure names what failed rather than "something went wrong".
      await expect(failure).not.toHaveText(/^Something went wrong/)
      // And the way forward is still there, because a device that cannot
      // subscribe has not done anything wrong.
      await expect(page.getByRole("button", { name: "Not now" })).toBeVisible()
    }
  } finally {
    await admin.from("push_subscriptions").delete().eq("user_id", userId)
    await close()
  }
})

/* ------------------------------------------------------------------ 10d --
 * The settings toggle. Same three states, one screen further in.
 */

const SETTINGS = "/settings"

test("settings offers the switch, and never asks on render either", async ({
  browser,
}) => {
  const { page, close } = await signedIn(browser, GRANTED_COUNTING)
  await page.goto(SETTINGS)

  const section = page.getByRole("region", { name: "Notifications" })
  await expect(section.getByRole("heading", { name: /this device/i })).toBeVisible()

  // Nothing on a settings page should spend the one ask a browser grants,
  // least of all a section someone scrolled past on their way to something
  // else.
  await expect.poll(() => page.evaluate(() => window.__askCount)).toBe(0)

  // "Off" rather than "on": the stub grants permission, but this browser holds
  // no subscription and the server has no row, and the toggle reports the
  // conjunction rather than the permission.
  await expect(
    section.getByRole("button", { name: "Turn on notifications" }),
  ).toBeVisible()

  await close()
})

test("a blocked browser gets the same explanation in settings, not a dead switch", async ({
  browser,
}) => {
  const { page, close } = await signedIn(browser, DENIED)
  await page.goto(SETTINGS)

  const section = page.getByRole("region", { name: "Notifications" })
  await expect(section.getByText(/blocking notifications for Solarity/i)).toBeVisible()
  await expect(section.getByRole("button")).toHaveCount(0)
  await expect(section.getByRole("link", { name: /How to do it in/i })).toHaveCount(4)

  await close()
})

test("the toggle reports the row, not the permission", async ({ browser }) => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))

  // A subscription this browser does not hold. The local check would have to
  // say "off" anyway; what this pins is that a row alone is not enough either,
  // so the two can never disagree silently.
  const endpoint = `https://fcm.googleapis.com/fcm/send/E2E-${Date.now()}`
  await admin.from("push_subscriptions").insert({
    user_id: userId,
    endpoint,
    p256dh: "e2e-p256dh",
    auth: "e2e-auth",
  })

  const { page, close } = await signedIn(browser, GRANTED_COUNTING)

  try {
    await page.goto(SETTINGS)
    const section = page.getByRole("region", { name: "Notifications" })

    await expect(
      section.getByRole("button", { name: "Turn on notifications" }),
    ).toBeVisible()
    await expect(
      section.getByRole("button", { name: "Turn off notifications" }),
    ).toHaveCount(0)
  } finally {
    await admin.from("push_subscriptions").delete().eq("endpoint", endpoint)
    await close()
  }
})

test("turning it on from settings says what happened, whatever happened", async ({
  browser,
}) => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
  const { page, close } = await signedIn(browser, GRANTED_COUNTING)

  try {
    await page.goto(SETTINGS)
    const section = page.getByRole("region", { name: "Notifications" })
    await section.getByRole("button", { name: "Turn on notifications" }).click()

    const on = section.getByText("Notifications are on for this device.")
    const failure = section.locator('p[role="alert"]')
    await expect(on.or(failure)).toBeVisible({ timeout: 20_000 })

    const { count } = await admin
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .then((r) => ({ count: r.count ?? 0 }))

    if (await on.isVisible()) {
      expect(count).toBeGreaterThan(0)
      // And it now offers the other direction, rather than staying a one-way
      // switch that has to be undone in browser settings.
      await expect(
        section.getByRole("button", { name: "Turn off notifications" }),
      ).toBeVisible()
    } else {
      expect(count).toBe(0)
      // Still offered, because a device that could not subscribe has not opted
      // out of anything.
      await expect(
        section.getByRole("button", { name: "Turn on notifications" }),
      ).toBeVisible()
    }
  } finally {
    await admin.from("push_subscriptions").delete().eq("user_id", userId)
    await close()
  }
})

/* ------------------------------------------------------------------ 10e --
 * Re-subscription, which happens with nobody watching.
 */

/** Permission never granted, and a counter to prove nothing asks for it. */
const NEVER_ASKED = `
  window.__askCount = 0;
  window.Notification = function () {};
  Object.defineProperty(window.Notification, 'permission', { get: () => 'default' });
  window.Notification.requestPermission = function () {
    window.__askCount++;
    return Promise.resolve('default');
  };
`

test("a rotated subscription repairs itself without ever prompting", async ({
  browser,
}) => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
  const { page, close } = await signedIn(browser, NEVER_ASKED)

  await admin.from("push_subscriptions").delete().eq("user_id", userId)

  try {
    await page.goto("/dashboard")

    // The real trigger is `pushsubscriptionchange`, which a browser fires on its
    // own schedule and no test can provoke. What *can* be exercised is the
    // half this step wrote: the message the worker posts, and what the page
    // does with it. Dispatched on `navigator.serviceWorker`, which is the
    // object the registrar listens on.
    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent("message", { data: { type: "RESUBSCRIBE_PUSH" } }),
      )
    })

    // **The assertion this test exists for.** Permission is `default` here, so
    // a repair path that reached for `requestPermission` would spend the one
    // ask a browser ever grants, triggered by a background event, on a screen
    // the person is not looking at. It must stay at zero.
    await expect
      .poll(() => page.evaluate(() => window.__askCount), {
        message: "re-subscription asked for permission",
      })
      .toBe(0)

    // And it wrote nothing, because there was nothing to repair.
    const { count } = await admin
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .then((r) => ({ count: r.count ?? 0 }))
    expect(count).toBe(0)

    // The page is still usable: a fire-and-forget repair must not surface as an
    // error over whatever someone was doing.
    await expect(page.locator('p[role="alert"]').filter({ hasText: /\S/ })).toHaveCount(0)
  } finally {
    await admin.from("push_subscriptions").delete().eq("user_id", userId)
    await close()
  }
})

/* ------------------------------------------------------------------ 10f --
 * The nudge on the notifications tab, and the four people it must not bother.
 */

const TAB = "/dashboard?tab=notifications"

test("the nudge offers notifications to someone who never decided", async ({
  browser,
}) => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
  const { page, close } = await signedIn(browser, DISMISSED)

  await admin.from("push_subscriptions").delete().eq("user_id", userId)

  try {
    await page.goto(TAB)

    const nudge = page.getByText(/waiting on you\. At most one notification/i)
    await expect(nudge).toBeVisible()

    // It links to the control rather than asking here. The single ask a browser
    // grants belongs on a screen that explains itself first.
    await expect(page.getByRole("link", { name: "Turn on notifications" })).toHaveAttribute(
      "href",
      "/settings#notifications",
    )
  } finally {
    await close()
  }
})

test("dismissing the nudge sticks across a reload", async ({ browser }) => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
  const { page, close } = await signedIn(browser, DISMISSED)

  await admin.from("push_subscriptions").delete().eq("user_id", userId)

  try {
    await page.goto(TAB)
    const nudge = page.getByText(/waiting on you\. At most one notification/i)
    await expect(nudge).toBeVisible()

    await page.getByRole("button", { name: "No thanks" }).click()
    await expect(nudge).toHaveCount(0)

    // The cookie is the point: hiding it in local state alone would bring it
    // straight back, which is how a dismissal becomes a lie.
    await expect
      .poll(async () => {
        const cookie = (await page.context().cookies()).find(
          (c) => c.name === "solarity_push_nudge",
        )
        return cookie?.value ?? null
      })
      .toBe("1")

    await page.reload()
    await expect(nudge).toHaveCount(0)
  } finally {
    await close()
  }
})

test("the nudge stays away from everyone who has already decided", async ({
  browser,
}) => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
  await admin.from("push_subscriptions").delete().eq("user_id", userId)

  // Blocked: this line could not fix it, and settings carries the help.
  const denied = await signedIn(browser, DENIED)
  try {
    await denied.page.goto(TAB)
    await expect(denied.page.getByRole("button", { name: "No thanks" })).toHaveCount(0)
  } finally {
    await denied.close()
  }

  // Already said yes: nothing to suggest. `GRANTED_COUNTING` also proves the
  // nudge never reaches for the prompt itself.
  const granted = await signedIn(browser, GRANTED_COUNTING)
  try {
    await granted.page.goto(TAB)
    await expect(granted.page.getByRole("button", { name: "No thanks" })).toHaveCount(0)
    await expect.poll(() => granted.page.evaluate(() => window.__askCount)).toBe(0)
  } finally {
    await granted.close()
  }
})

/* ------------------------------------------------------------------ 10g --
 * What a notification is allowed to say. Per account, not per device.
 */

test("the Circle-name setting saves, persists, and is not the device toggle", async ({
  browser,
}) => {
  const userId = await userIdByEmail(requireEnv("E2E_OWNER_EMAIL"))
  const { page, close } = await signedIn(browser, DENIED)

  const { data: before } = await admin
    .from("users")
    .select("push_shows_circle_name")
    .eq("id", userId)
    .single()

  try {
    await page.goto("/settings")
    const form = page.getByRole("form", { name: "Notification detail" })
    const box = form.getByRole("checkbox")

    // On by default: an unattributable notification is the failure this piece
    // exists to fix.
    await expect(box).toBeChecked()

    await box.uncheck()
    await form.getByRole("button", { name: "Save" }).click()
    await expect(form.getByText("Saved.")).toBeVisible()

    // The database, not the checkbox. A form that reports success and writes
    // nothing is a shape this codebase has already met once.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("users")
          .select("push_shows_circle_name")
          .eq("id", userId)
          .single()
        return data?.push_shows_circle_name
      })
      .toBe(false)

    await page.reload()
    await expect(page.getByRole("form", { name: "Notification detail" }).getByRole("checkbox")).not.toBeChecked()

    // **Independent of the device toggle.** This context has permission denied,
    // so the toggle above is not even a switch — and this setting still works,
    // because what a notification may say is an account fact and whether this
    // browser gets one is a device fact.
    await expect(
      page.getByRole("region", { name: "Notifications" }).getByRole("button"),
    ).toHaveCount(0)
  } finally {
    await admin
      .from("users")
      .update({ push_shows_circle_name: before?.push_shows_circle_name ?? true })
      .eq("id", userId)
    await close()
  }
})

declare global {
  interface Window {
    __askCount?: number
  }
}
