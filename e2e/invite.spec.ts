import { test, expect, type Browser, type Page } from "@playwright/test"
import {
  circleName,
  clearRateLimits,
  createCircleViaApi,
  deleteE2ECircles,
  findCircleByName,
  inviteTokenFor,
  requireEnv,
} from "./db"
import { storageStateFor } from "./session"
import { diagnose } from "./diagnose"

const DEAD_LINK = /no longer valid/i

/**
 * Two long-lived contexts, one per account, opened once for the whole file.
 *
 * A context per test meant a session per test, and Supabase's auth rate limit
 * is hourly and separate from the app's own. Exhausting it does not fail
 * loudly; refreshes start returning 429, `@supabase/ssr` drops the session, and
 * a test several files later fails as if it were signed out.
 */
let ctx: { ownerPage: Page; joinerPage: Page; close: () => Promise<void> } | null = null

async function pages(browser: Browser) {
  if (ctx) return ctx

  const ownerCtx = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
  })
  const joinerCtx = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_JOINER_EMAIL")),
  })

  ctx = {
    ownerPage: await ownerCtx.newPage(),
    joinerPage: await joinerCtx.newPage(),
    close: async () => {
      await ownerCtx.close()
      await joinerCtx.close()
      ctx = null
    },
  }
  return ctx
}

/**
 * Creates a Circle through the dashboard form.
 *
 * Kept for the one test that is about the form. `enforce("createCircle")` lives
 * in the server action rather than in the RPC, so this path and only this path
 * spends from the 5-a-day budget. Everything else in this file builds its
 * Circle with `createCircleViaApi`, because needing a Circle to exist is not
 * the same as testing how one is made.
 */
async function createCircleInTheUi(page: Page, label: string) {
  const name = circleName(label)
  // `?tab=circles` since 8f-1. The list and the create form moved off Overview,
  // and a bare `/dashboard` now renders the check-in panel and goals instead.
  await page.goto("/dashboard/circles")
  await page.getByLabel("Start a Circle").fill(name)
  await page.getByRole("button", { name: "Create Circle" }).click()
  await expect(page.getByRole("link", { name })).toBeVisible()
  return name
}

/** Mints an invite link on an already-open settings page. Returns the full URL. */
async function generateLink(page: Page) {
  // Assert we are on the page before reaching for a control on it.
  //
  // Without this, a settings route that fails to serve spends the full test
  // timeout "waiting for getByRole('button', { name: 'Generate link' })" and
  // reports as a missing button. It has happened once already, and the answer
  // was a bare 404 from the dev server for a route that exists, unmodified, in
  // the repo. Thirty seconds of silence versus a sentence naming the page.
  await expect(
    page.getByRole("heading", { name: "Circle settings" }),
    `Settings did not load. Landed on ${page.url()}`,
  ).toBeVisible()

  await page.getByRole("button", { name: "Generate link" }).click()

  // Waiting for an absolute URL, not merely for the element.
  //
  // `invite-panel.tsx` reads `location.origin` through `useSyncExternalStore`
  // with an empty server snapshot, so the server renders `/join/<token>` and
  // the browser swaps in the origin at hydration. Read a moment too early and
  // you get the relative path, which makes `new URL(link)` throw several lines
  // later with an error that says nothing about hydration.
  const url = page.locator("code")
  await expect(url).toHaveText(/^https?:\/\/\S+\/join\/\S+$/)
  return (await url.innerText()).trim()
}

/** Settings for a Circle whose id is already known, without going via the dashboard. */
async function openSettings(page: Page, groupId: string) {
  await page.goto(`/circles/${groupId}/settings`)
}

// One Circle here now comes from the form, against a cap of 5 a day. The
// clearing stays so a run does not inherit whatever manual testing left behind.
test.beforeAll(async () => {
  await clearRateLimits()
})

test.afterAll(async () => {
  await deleteE2ECircles()
  await ctx?.close()
})

test.describe("invite link lifecycle", () => {
  test("generating, regenerating and revoking", async ({ browser }) => {
    const { ownerPage: page } = await pages(browser)

    // Through the form deliberately: this is the test that covers it.
    const name = await createCircleInTheUi(page, "invite")

    // ---------------------------------------------------------------------
    // Wait for the Circle page before reaching for its Settings link.
    //
    // **"Settings" stopped being unique in 8f-1.** The dashboard now carries a
    // gear `Link` with `aria-label="Settings"`, so a `getByRole("link", { name:
    // "Settings" })` issued while still on the dashboard matches *that* and
    // lands on `/settings`, the account page. The failure then reads as "Circle
    // settings did not load", which is true and points nowhere near the cause.
    //
    // The general form: after a click that navigates, wait for the destination
    // before locating anything on it. Playwright waits for the *element*, not
    // for the page you meant to be on, and a name that is unique on the
    // destination need not be unique on the origin.
    // ---------------------------------------------------------------------
    await page.getByRole("link", { name }).click()
    await page.waitForURL(/\/circles\/[0-9a-f-]+$/)
    await page.getByRole("link", { name: "Settings" }).click()
    await page.waitForURL(/\/circles\/[0-9a-f-]+\/settings$/)

    const first = await generateLink(page)
    expect(first).toContain("/join/")

    // Regenerating must warn first. A bare button here would silently kill a
    // link people are already holding, which is the whole reason for the
    // two-step.
    await page.getByRole("button", { name: "Generate a new link" }).click()
    await expect(page.getByText(/turns off the link above/i)).toBeVisible()

    await page.getByRole("button", { name: "Replace it" }).click()

    // Wait for the displayed token to change before reading it. The panel shows
    // the server's `token` prop and nothing optimistic, so between the click and
    // `revalidatePath` landing there is a window where the old link is still on
    // screen. Reading immediately made this pass or fail on timing rather than
    // on behaviour.
    await expect(page.locator("code")).not.toHaveText(first)
    const second = (await page.locator("code").innerText()).trim()
    expect(second).not.toBe(first)

    // The superseded link is dead, and reads as dead rather than as a 404.
    await page.goto(new URL(first).pathname)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByText(DEAD_LINK)).toBeVisible()

    // Revoking leaves no link at all, so the warning has nothing to warn about
    // and the plain create button comes back.
    await page.goBack()
    await page.getByRole("button", { name: "Revoke" }).click()
    await expect(page.getByText(/No live link/i)).toBeVisible()
    await expect(page.getByRole("button", { name: "Generate link" })).toBeVisible()
  })

  test("archiving kills the link", async ({ browser }) => {
    const { ownerPage: page } = await pages(browser)
    const { name, groupId } = await createCircleViaApi(
      requireEnv("E2E_OWNER_EMAIL"),
      "archive",
    )

    await openSettings(page, groupId)
    const link = await generateLink(page)

    await page.getByRole("button", { name: "Archive this Circle" }).click()
    await expect(page.getByText(/can't be undone/i)).toBeVisible()
    await page.getByRole("button", { name: "Archive this Circle" }).click()

    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByText(/Circle archived/i)).toBeVisible()

    const circle = await findCircleByName(name)
    expect(circle?.group_status).toBe("archived")

    // The point of the test: an archived Circle's link is revoked by trigger,
    // so it takes the dead-link path rather than reaching join_circle at all.
    await page.goto(new URL(link).pathname)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByText(DEAD_LINK)).toBeVisible()
  })
})

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("previews a live invite without signing in", async ({ page }) => {
    // No owner browser at all now: the link is minted over the API, and this
    // context stays anonymous, which is the only thing the test is about.
    const ownerEmail = requireEnv("E2E_OWNER_EMAIL")
    const { name, groupId } = await createCircleViaApi(ownerEmail, "preview")
    const token = await inviteTokenFor(ownerEmail, groupId)

    await page.goto(`/join/${token}`)

    await expect(page.getByRole("heading", { name })).toBeVisible()
    await expect(page.getByText(/1 of 10 member/)).toBeVisible()
    await expect(page.getByRole("link", { name: "Sign in to join" })).toBeVisible()

    // `next` has to survive, or signing in dumps people on the dashboard and
    // the invite is lost.
    //
    // Asserted by parsing the query rather than by regex on the raw URL. The
    // app writes `next=/join/<token>` with only the token encoded, and a regex
    // built from `encodeURIComponent(pathname)` expects `%2Fjoin%2F…`, so the
    // original assertion failed on a working app. Which of the two spellings
    // the browser reports is not something this test should care about;
    // `searchParams` decodes either.
    await page.getByRole("link", { name: "Sign in to join" }).click()
    await page.waitForURL(/\/auth\/sign-in/)

    const next = new URL(page.url()).searchParams.get("next")
    expect(next).toBe(`/join/${token}`)
  })

  test("a made-up token reveals nothing and lands on the landing page", async ({
    page,
  }) => {
    await page.goto("/join/definitely-not-a-real-token")

    // `/` and not `/dashboard`: a signed-out visitor sent to the dashboard is
    // bounced to sign-in and loses the explanation on the way.
    await expect(page).toHaveURL(/\/\?notice=invite-invalid/)
    await expect(page.getByText(DEAD_LINK)).toBeVisible()
    await expect(page.getByRole("heading", { name: "Solarity" })).toBeVisible()
  })
})

test.describe("joining", () => {
  test("a second account joins, and joining twice is harmless", async ({ browser }) => {
    const { ownerPage, joinerPage } = await pages(browser)
    const ownerEmail = requireEnv("E2E_OWNER_EMAIL")
    const { name, groupId } = await createCircleViaApi(ownerEmail, "join")
    const token = await inviteTokenFor(ownerEmail, groupId)

    // Attached before the click. A server action that fails leaves the button on
    // "Joining…" and the URL unchanged, and the actual cause is a console error
    // or a non-200 on the action POST, neither of which reaches the assertion
    // message on its own.
    const report = diagnose(joinerPage)

    await joinerPage.goto(`/join/${token}`)
    await joinerPage.getByRole("button", { name: new RegExp(`Join ${name}`) }).click()

    await joinerPage.waitForURL(/\/circles\//, { timeout: 15_000 }).catch(() => {
      throw new Error(
        `Joining did not navigate. Still at ${joinerPage.url()}\n\n${report()}`,
      )
    })

    // The count sits in the page header, above the tabs, so no tab click is
    // needed and this assertion does not move when the default tab does.
    await expect(joinerPage.getByText(/2 of 10 members/)).toBeVisible()

    // `join_circle` returns the group id without writing when you are already a
    // member, so a stale tab or a double tap lands on the Circle rather than
    // erroring.
    await joinerPage.goto(`/join/${token}`)
    await joinerPage.getByRole("button", { name: new RegExp(`Join ${name}`) }).click()
    await joinerPage.waitForURL(/\/circles\//, { timeout: 15_000 })
    // Still two, not three: a second join must not write a second membership.
    await expect(joinerPage.getByText(/2 of 10 members/)).toBeVisible()

    // Regression: the dashboard listed a Circle once per member.
    //
    // `group_members`' SELECT policy is `is_group_member(group_id)`, so it
    // returns every member row of every Circle you are in. The dashboard read
    // it without `.eq("user_id", …)` on the theory that RLS had already scoped
    // it, and RLS had: to the caller's *Circles*, not the caller's
    // *memberships*. A Circle of two rendered twice, each row showing a
    // different person's role.
    //
    // Only reproducible with two members, which is why every earlier test
    // missed it and only a React duplicate-key warning gave it away.
    for (const p of [joinerPage, ownerPage]) {
      await p.goto("/dashboard/circles")
      await expect(p.getByRole("link", { name })).toHaveCount(1)
    }
  })
})
