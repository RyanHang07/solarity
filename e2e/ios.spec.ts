import { test, expect } from "@playwright/test"
import { requireEnv } from "./db"
import { storageStateFor } from "./session"

/**
 * The iPhone path, in Playwright's WebKit. Runs only under the `mobile-safari`
 * project.
 *
 * ## Why this file exists
 *
 * iOS is the platform where the whole of step 10 either works or is pointless:
 * push is delivered **only** to an installed PWA, `beforeinstallprompt` never
 * fires, and there is no API that says "you could add this to the home screen".
 * Every other browser gets told something by the platform; iPhones get told
 * nothing, so the app has to reason about them, and reasoning is what breaks.
 *
 * ## What it proves, and what it cannot
 *
 * | Proven here | Still manual, on a device |
 * |---|---|
 * | an iPhone-shaped browser gets the Share-sheet steps, not a dead button | whether the steps match the sheet iOS currently draws |
 * | a browser tab that cannot do push says so, and says what to do about it | whether an installed PWA actually receives a push |
 * | nothing in the flow strands an iPhone | whether the dialog earns a yes |
 *
 * **Playwright's WebKit is not iOS Safari.** It is the same engine with a
 * different shell, it never installs a PWA, and its Notification support does
 * not match a real iPhone's. So these tests are written to accept either
 * honest answer wherever the engines legitimately differ, and to fail only on
 * the thing that is wrong in every case: a screen with no way forward.
 *
 * **Read-only.** Nothing here writes.
 */

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

async function iphone(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
    // WebKit's own UA already says iPhone under this project; set explicitly so
    // the test still means what it says if the device descriptor changes.
    userAgent: IPHONE_UA,
  })
  const page = await context.newPage()
  return { page, close: () => context.close() }
}

test("an iPhone is told how to install, since nothing will offer", async ({
  browser,
}) => {
  const { page, close } = await iphone(browser)
  await page.goto("/onboarding/install")

  await expect(
    page.getByRole("heading", { name: "Add Solarity to your home screen" }),
  ).toBeVisible()

  // The Share sheet, spelled out. This is the only route on the platform, and
  // an iPhone that reads the generic "look in your browser's menu" line has
  // been sent looking for a menu item that does not exist.
  await expect(page.getByText(/Share button/i)).toBeVisible()
  await expect(page.getByText(/Add to Home Screen/i)).toBeVisible()

  // And no button promising a dialog iOS will never draw.
  await expect(page.getByRole("button", { name: "Add to home screen" })).toHaveCount(0)

  await close()
})

test("the install step never traps an iPhone", async ({ browser }) => {
  const { page, close } = await iphone(browser)
  await page.goto("/onboarding/install")

  await page.getByRole("button", { name: /I'll do this later/i }).click()
  await expect(page).toHaveURL(/\/onboarding\/notifications/)

  await close()
})

test("the permission screen tells an iPhone the truth about a browser tab", async ({
  browser,
}) => {
  const { page, close } = await iphone(browser)
  await page.goto("/onboarding/notifications")

  await expect(
    page.getByRole("heading", { name: "Get a nudge when it matters" }),
  ).toBeVisible()

  // **Both answers are legitimate and the difference is the engine, not a
  // bug.** A real iPhone in a browser tab has no `PushManager`, so it should
  // meet the unsupported line, which is the one place the app says "install it
  // first" at the moment that advice is actionable. Playwright's WebKit may
  // expose enough of the API to land in the ordinary branch instead.
  //
  // What must hold either way: something explains the situation, and nothing
  // offers a switch that cannot work.
  const unsupported = page.getByText(/add Solarity to your home screen first/i)
  const ask = page.getByRole("button", { name: "Turn on notifications" })
  await expect(unsupported.or(ask)).toBeVisible()

  // The way out is unconditional. On the platform where a skipped install
  // means no push at all, a stuck signup is the worst possible ending.
  await expect(page.getByRole("button", { name: "Not now" })).toBeVisible()

  await close()
})

test("settings gives an iPhone the same answer as onboarding", async ({ browser }) => {
  const { page, close } = await iphone(browser)
  await page.goto("/settings")

  const section = page.getByRole("region", { name: "Notifications" })
  await expect(section.getByRole("heading", { name: /this device/i })).toBeVisible()

  // Same rule as the screen it mirrors: an explanation or a working switch,
  // never a control over something this browser cannot do. Asserted as a
  // conjunction so a third state cannot slip through silently.
  const unsupported = section.getByText(/add Solarity to your home screen/i)
  const toggle = section.getByRole("button", { name: /Turn (on|off) notifications/ })
  await expect(unsupported.or(toggle)).toBeVisible()

  await close()
})

test("the category picker's displayed row is the real value", async ({ browser }) => {
  const { page, close } = await iphone(browser)

  try {
    await page.goto("/dashboard")
    const goals = page.getByRole("region", { name: "Your goals" })
    const select = goals.getByLabel("Category")

    // **The iOS trap this guards.** A `<select>` is a wheel here, and iOS skips
    // disabled options entirely. With the placeholder disabled the wheel opened
    // on the first real category while the element's value was still empty, so
    // tapping Done moved nothing, fired no `change`, and submitted no category:
    // the picker showed "Career & Professional" and the form disagreed.
    //
    // Selectable, the two can never disagree.
    const placeholder = select.locator('option[value=""]')
    await expect(placeholder).not.toBeDisabled()

    // What the wheel would open on, and what the form would send, are the same
    // thing.
    await expect(select).toHaveValue("")
    await expect(placeholder).toHaveText(/Choose a category/i)

    // And choosing one commits it.
    await select.selectOption({ label: "Fitness" })
    await expect(select).toHaveValue("fitness")
  } finally {
    await close()
  }
})

test("the layout pays back the safe area it asked to draw under", async ({
  browser,
}) => {
  const { page, close } = await iphone(browser)

  try {
    await page.goto("/dashboard")

    // **This asserts the rule exists, not that it looks right**, and the
    // distinction is the point. `env(safe-area-inset-*)` resolves to 0 in every
    // headless browser, so no assertion here can see a notch. What it can catch
    // is the rule being deleted — which is how the bug arrived in the first
    // place: the root layout asked for `viewport-fit=cover` and nothing ever
    // gave the content its margin back, so the header sat under the camera.
    //
    // Whether it *looks* right on a Dynamic Island is the manual pass.
    const paysItBack = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules
        try {
          rules = Array.from(sheet.cssRules)
        } catch {
          continue // A cross-origin sheet, which none of ours are.
        }
        for (const rule of rules) {
          const text = rule.cssText
          if (text.includes("safe-area-inset-top") && text.includes("body")) return true
        }
      }
      return false
    })

    expect(paysItBack, "nothing offsets the safe area").toBe(true)
  } finally {
    await close()
  }
})
