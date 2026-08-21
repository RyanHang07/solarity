import { test, expect, type Browser, type Page } from "@playwright/test"
import { requireEnv } from "./db"
import { storageStateFor } from "./session"

/**
 * Step 10b. The install nudge, and the four branches it can render.
 *
 * **What a browser test can and cannot reach here.** Chromium fires
 * `beforeinstallprompt` only when it decides the app is installable, and not at
 * all in a headless run, so the real event never arrives. The branch it drives
 * is still worth testing, because the wiring is the part that breaks: the event
 * is captured by an inline script before hydration, stashed on `window`, and
 * read on mount. These tests plant the same object the script would and assert
 * the React side does the rest.
 *
 * What stays manual, on a real device: whether the dialog actually opens, and
 * whether the iOS steps match the Share sheet iOS currently draws. Recorded as
 * the manual pass in `docs/build-plan.md`.
 *
 * **Read-only.** Nothing here writes to the database.
 */

const PATH = "/onboarding/install"

/** What the inline listener stashes, minus the parts the component ignores. */
function fakePrompt(outcome: "accepted" | "dismissed") {
  return `
    window.__promptCalls = 0;
    window.__solarityInstallPrompt = {
      prompt: function () { window.__promptCalls++; return Promise.resolve(); },
      userChoice: Promise.resolve({ outcome: '${outcome}' }),
    };
  `
}

let ctx: { page: Page; close: () => Promise<void> } | null = null

async function ownerPage(browser: Browser) {
  if (ctx) return ctx.page
  const context = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
  })
  ctx = {
    page: await context.newPage(),
    close: () => context.close(),
  }
  return ctx.page
}

test.afterAll(async () => {
  await ctx?.close()
  ctx = null
})

test("the nudge falls back to instructions when no install event exists", async ({
  browser,
}) => {
  const p = await ownerPage(browser)
  await p.goto(PATH)

  // Headless Chromium never fires `beforeinstallprompt`, so this is the branch
  // that assumes nothing — the same one the server renders.
  await expect(
    p.getByRole("heading", { name: "Add Solarity to your home screen" }),
  ).toBeVisible()
  // Named by its opening words, not by "browser's menu": the footnote used to
  // say that too, and matching both is how the duplication was found.
  await expect(p.getByText(/Look for Install/i)).toBeVisible()

  // The point of the branch: no button that would do nothing when tapped.
  await expect(p.getByRole("button", { name: "Add to home screen" })).toHaveCount(0)
})

test("the inline script is listening before anything else runs", async ({
  browser,
}) => {
  const p = await ownerPage(browser)
  await p.goto(PATH)

  // **Nothing else here proves the capture script exists.** Every other test
  // plants `window.__solarityInstallPrompt` with `addInitScript`, which would
  // pass just as happily if the root layout's inline listener had been deleted
  // — and that listener is the entire reason a real install button can work,
  // because `beforeinstallprompt` fires once and cannot be asked for later.
  //
  // Firing a synthetic event is the one way to ask "did anyone subscribe?".
  const captured = await p.evaluate(() => {
    const event = new Event("beforeinstallprompt") as Event & {
      prompt?: () => Promise<void>
    }
    event.prompt = () => Promise.resolve()
    window.dispatchEvent(event)
    return Boolean((window as unknown as Record<string, unknown>).__solarityInstallPrompt)
  })

  expect(captured, "the root layout's beforeinstallprompt listener is missing").toBe(
    true,
  )

  // And the page reacted rather than merely stashing it, which is the other
  // half of the contract: the script dispatches its own event and the nudge
  // listens for it.
  await expect(p.getByRole("button", { name: "Add to home screen" })).toBeVisible()
})

test("skipping the nudge continues the flow", async ({ browser }) => {
  const p = await ownerPage(browser)
  await p.goto(PATH)

  // The guarantee that matters. A wrong guess about the platform must cost a
  // paragraph, never a signup.
  await p.getByRole("button", { name: /I'll do this later/i }).click()

  // **The next screen, not the dashboard.** 10c inserted the permission ask
  // between the two, and this assertion is the reason the change was noticed
  // rather than discovered later: the order matters, because on iOS push works
  // only inside an installed PWA. `push.spec.ts` owns the exit from there.
  await expect(p).toHaveURL(/\/onboarding\/notifications/)
})

test("a captured install event turns into a real button", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
  })
  const p = await context.newPage()

  // Runs before any page script, which is exactly where the real listener
  // stashes its event. The component reads `window` on mount, so no synthetic
  // dispatch is needed.
  await p.addInitScript(fakePrompt("accepted"))
  await p.goto(PATH)

  const button = p.getByRole("button", { name: "Add to home screen" })
  await expect(button).toBeVisible()
  await button.click()

  await expect.poll(() => p.evaluate(() => window.__promptCalls)).toBe(1)

  // Accepting hands over to the installed app and the browser reloads this page
  // inside it, so the component deliberately does not navigate.
  await expect(p).toHaveURL(new RegExp(PATH))

  await context.close()
})

test("a dismissed dialog leaves a way forward rather than an error", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
  })
  const p = await context.newPage()

  await p.addInitScript(fakePrompt("dismissed"))
  await p.goto(PATH)

  await p.getByRole("button", { name: "Add to home screen" }).click()

  // Falls back to the instructions, and the event is spent, so the button that
  // could only fail is gone.
  await expect(p.getByText(/Look for Install/i)).toBeVisible()
  await expect(p.getByRole("button", { name: "Add to home screen" })).toHaveCount(0)
  await expect(p.getByRole("button", { name: /I'll do this later/i })).toBeVisible()

  await context.close()
})

test("an iPhone gets the Share-sheet steps, since it has no install event", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  })
  const p = await context.newPage()
  await p.goto(PATH)

  // The one platform that can install but never announces it. Without the sniff
  // every iPhone gets the generic branch, on the platform where skipping the
  // install means push never works at all.
  await expect(p.getByText(/Add to Home Screen/i)).toBeVisible()
  await expect(p.getByText(/Share button/i)).toBeVisible()
  await expect(p.getByRole("button", { name: /I'll do this later/i })).toBeVisible()

  await context.close()
})

test("signing out puts the nudge behind the sign-in screen", async ({ browser }) => {
  const context = await browser.newContext()
  const p = await context.newPage()
  await p.goto(PATH)

  await expect(p).toHaveURL(/\/auth\/sign-in/)

  await context.close()
})

declare global {
  interface Window {
    __promptCalls?: number
  }
}
