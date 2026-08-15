import { test, expect, type Page } from "@playwright/test"
import { circleName, clearRateLimits, deleteE2ECircles, findCircleByName } from "./db"
import { statePath } from "./auth-state"
import { diagnose } from "./diagnose"

const OWNER = statePath("owner")
const JOINER = statePath("joiner")

const DEAD_LINK = /no longer valid/i

/** Creates a Circle through the dashboard form and returns its name. */
async function createCircle(page: Page, label: string) {
  const name = circleName(label)
  await page.goto("/dashboard")
  await page.getByLabel("Start a Circle").fill(name)
  await page.getByRole("button", { name: "Create Circle" }).click()
  await expect(page.getByRole("link", { name })).toBeVisible()
  return name
}

/** Opens a Circle's settings and mints an invite link. Returns the full URL. */
async function generateLink(page: Page, name: string) {
  await page.getByRole("link", { name }).click()
  await page.getByRole("link", { name: "Settings" }).click()
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

// This file creates 4 Circles and the cap is 5 a day per account, so it starts
// from a full budget rather than from whatever manual testing left behind.
test.beforeAll(async () => {
  await clearRateLimits()
})

test.afterAll(async () => {
  await deleteE2ECircles()
})

test.describe("invite link lifecycle", () => {
  test.use({ storageState: OWNER })

  test("generating, regenerating and revoking", async ({ page }) => {
    const name = await createCircle(page, "invite")
    const first = await generateLink(page, name)
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

  test("archiving kills the link", async ({ page }) => {
    const name = await createCircle(page, "archive")
    const link = await generateLink(page, name)

    await page.getByRole("button", { name: "Archive this Circle" }).click()
    await expect(page.getByText(/can't be undone/i)).toBeVisible()
    await page
      .getByRole("button", { name: "Archive this Circle" })
      .click()

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

  test("previews a live invite without signing in", async ({ browser, page }) => {
    // The link has to be made by someone, so a second context does that as the
    // owner while this one stays anonymous.
    const ownerContext = await browser.newContext({ storageState: OWNER })
    const ownerPage = await ownerContext.newPage()
    const name = await createCircle(ownerPage, "preview")
    const link = await generateLink(ownerPage, name)
    await ownerContext.close()

    await page.goto(new URL(link).pathname)

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
    expect(next).toBe(new URL(link).pathname)
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
  test("a second account joins, and joining twice is harmless", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext({ storageState: OWNER })
    const ownerPage = await ownerContext.newPage()
    const name = await createCircle(ownerPage, "join")
    const link = await generateLink(ownerPage, name)

    const joinerContext = await browser.newContext({ storageState: JOINER })
    const joinerPage = await joinerContext.newPage()

    // Attached before the click. A server action that fails leaves the button on
    // "Joining…" and the URL unchanged, and the actual cause is a console error
    // or a non-200 on the action POST, neither of which reaches the assertion
    // message on its own.
    const report = diagnose(joinerPage)

    await joinerPage.goto(new URL(link).pathname)
    await joinerPage.getByRole("button", { name: new RegExp(`Join ${name}`) }).click()

    await joinerPage
      .waitForURL(/\/circles\//, { timeout: 15_000 })
      .catch(() => {
        throw new Error(
          `Joining did not navigate. Still at ${joinerPage.url()}\n\n${report()}`,
        )
      })

    await expect(joinerPage.getByText(/2 of 10 members/)).toBeVisible()

    // `join_circle` returns the group id without writing when you are already a
    // member, so a stale tab or a double tap lands on the Circle rather than
    // erroring.
    await joinerPage.goto(new URL(link).pathname)
    await joinerPage.getByRole("button", { name: new RegExp(`Join ${name}`) }).click()
    await joinerPage.waitForURL(/\/circles\//, { timeout: 15_000 })
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
      await p.goto("/dashboard")
      await expect(p.getByRole("link", { name })).toHaveCount(1)
    }

    await joinerContext.close()
    await ownerContext.close()
  })
})
